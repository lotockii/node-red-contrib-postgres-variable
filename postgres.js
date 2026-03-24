const { Pool } = require('pg');
const named = require('node-postgres-named');
const fs = require('fs');
const caCache = new Map();

module.exports = function (RED) {

    /**
     * Helper function to get value from different contexts
     * @param {Object} node - Node instance
     * @param {string} value - Value to get
     * @param {string} type - Type of value (str, flow, global, env)
     * @param {Object} msg - Message object
     * @returns {string} Retrieved value
     */
    function getValueFromContext(node, value, type, msg) {
        if (value === null || value === undefined) return null;

        try {
            let result;
            switch (type) {
                case 'flow':
                    // For config nodes, we need to get flow context differently
                    const flowContext = node.context().flow;
                    if (!flowContext) {
                        return null;
                    }
                    result = getNestedValue(flowContext, value);
                    break;
                case 'global':
                    const globalContext = node.context().global;
                    if (!globalContext) {
                        return null;
                    }
                    result = getNestedValue(globalContext, value);
                    break;
                case 'env':
                    result = process.env[value];
                    break;
                case 'msg':
                    result = RED.util.getMessageProperty(msg, value);
                    break;
                default:
                    result = value;
            }

            return result !== undefined ? result : null;
        } catch (err) {
            throw new Error(`Failed to get value for type: ${type}, value: ${value}. Error: ${err.message}`);
        }
    }

    // Helper function to get nested values like "all_vars.host"
    function getNestedValue(context, path) {
        if (!context) return undefined;
        
        if (path.includes('.')) {
            const parts = path.split('.');
            let result = context.get(parts[0]);
            for (let i = 1; i < parts.length; i++) {
                if (result && typeof result === 'object') {
                    result = result[parts[i]];
                } else {
                    return undefined;
                }
            }
            return result;
        } else {
            return context.get(path);
        }
    }

    // Definition of a Postgres database configuration node
    function PostgresDatabaseNode(n) {
        RED.nodes.createNode(this, n);
        
        // Store the configuration values and types
        this.hostname = n.hostname;
        this.hostnameType = n.hostnameType || 'str';
        this.port = n.port;
        this.portType = n.portType || 'str';
        this.db = n.db;
        this.dbType = n.dbType || 'str';
        this.ssl = n.ssl;
        this.sslType = n.sslType || 'bool';
        this.ignore_check_ssl = n.ignore_check_ssl;
        this.ignore_check_sslType = n.ignore_check_sslType || 'bool';
        this.ssl_path = n.ssl_path;
        this.ssl_pathType = n.ssl_pathType || 'str';
        this.user = n.user;
        this.userType = n.userType || 'str';
        this.password = n.password;
        this.passwordType = n.passwordType || 'str';
        this.passwordContext = n.passwordContext || '';
        this.pool_max = n.pool_max;
        this.pool_maxType = n.pool_maxType || 'str';
        this.pool_idle_timeout = n.pool_idle_timeout;
        this.pool_idle_timeoutType = n.pool_idle_timeoutType || 'str';
        this.pool_connection_timeout = n.pool_connection_timeout;
        this.pool_connection_timeoutType = n.pool_connection_timeoutType || 'str';
        
        // Get credentials for string passwords
        const credentials = this.credentials || {};

        // Method to get configuration values with context resolution
        this.getConfig = function(msg, executingNode) {
            const config = {};
            const missing = [];

            const resolveValue = (name, rawValue, type, fallback) => {
                const resolved = getValueFromContext(executingNode || this, rawValue, type, msg);
                const isContext = type && type !== 'str' && type !== 'bool';
                if (isContext && (resolved === null || resolved === undefined)) {
                    missing.push(name);
                }
                return resolved !== null && resolved !== undefined && resolved !== '' ? resolved : fallback;
            };
            const resolveOptionalValue = (rawValue, type, fallback) => {
                const resolved = getValueFromContext(executingNode || this, rawValue, type, msg);
                return resolved !== null && resolved !== undefined && resolved !== '' ? resolved : fallback;
            };
            
            // Parse values using separate type fields
            config.hostname = resolveValue('host', this.hostname, this.hostnameType, 'localhost');
            const resolvedPort = resolveValue('port', this.port, this.portType, 5432);
            config.port = parseInt(resolvedPort, 10);
            if (!Number.isFinite(config.port) || config.port <= 0) {
                config.port = 5432;
                if (this.portType && this.portType !== 'str') {
                    missing.push('port');
                }
            }
            config.db = resolveValue('database', this.db, this.dbType, 'postgres');
            config.ssl = this.parseBooleanValue(this.ssl, this.sslType, msg, executingNode);
            config.ignore_check_ssl = this.parseBooleanValue(this.ignore_check_ssl, this.ignore_check_sslType, msg, executingNode);
            config.ssl_path = getValueFromContext(executingNode || this, this.ssl_path, this.ssl_pathType, msg);
            config.user = resolveValue('user', this.user, this.userType, '');
            config.password = this.parsePasswordValue(msg, executingNode) || '';
            if (this.passwordType && this.passwordType !== 'str' && (config.password === null || config.password === undefined)) {
                missing.push('password');
            }
            config.pool_max = resolveOptionalValue(this.pool_max, this.pool_maxType, 20);
            config.pool_idle_timeout = resolveOptionalValue(this.pool_idle_timeout, this.pool_idle_timeoutType, 10000);
            config.pool_connection_timeout = resolveOptionalValue(this.pool_connection_timeout, this.pool_connection_timeoutType, 30000);

            if (missing.length) {
                config._missing = Array.from(new Set(missing));
            }
            
            return config;
        };

        // Helper method to parse boolean values
        this.parseBooleanValue = function(inputValue, type, msg, executingNode) {
            if (!inputValue && inputValue !== false) return false;
            
            // If it's already a boolean
            if (typeof inputValue === 'boolean') {
                return inputValue;
            }
            
            // If it's a string representation of boolean
            if (typeof inputValue === 'string') {
                if (type === 'str') {
                    return inputValue === 'true';
                } else {
                    // Context type - resolve from context
                    const value = getValueFromContext(executingNode || this, inputValue, type, msg);
                    if (typeof value === 'boolean') return value;
                    if (typeof value === 'string') return value === 'true';
                    return !!value;
                }
            }
            
            // Fallback
            return !!inputValue;
        };

        // Helper method to parse password values with hybrid approach
        this.parsePasswordValue = function(msg, executingNode) {
            let password = '';
            
            if (this.passwordType === 'str' || !this.passwordType) {
                // String password - get from credentials
                const credentials = this.credentials || {};
                password = credentials.password || '';
            } else {
                // Context password - resolve from context
                password = getValueFromContext(executingNode || this, this.passwordContext, this.passwordType, msg);
            }
            
            // Ensure password is always a string
            if (password === null || password === undefined) {
                password = '';
            }
            
            return String(password);
        };
    }

    RED.nodes.registerType('postgresdb', PostgresDatabaseNode, {
        credentials: {
            password: { type: 'password' }
        }
    });

    async function executeQuery(pool, msg, node) {
        const sql = String(msg.payload || '').trim().toLowerCase();
        const isSelect = sql.startsWith('select');
        const hasLocking = /\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i.test(sql);
        const allowRetry = msg.allowRetry === true || (isSelect && !hasLocking);
        const isRetryable = (err) => {
            const code = err && err.code;
            if (code && ['ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(code)) return true;

            const m = String((err && err.message) || '');
            return (
                m.includes('Connection terminated unexpectedly') ||
                m.includes('connection timeout') ||
                m.includes('terminating connection') ||
                m.includes('server closed the connection')
            );
        };

        for (let attempt = 1; attempt <= 2; attempt++) {
            let client;
            let lastErr = null;
            try {
                client = await pool.connect();

                const queryParams = msg.queryParameters || {};
                const result = await client.query(msg.payload, queryParams);

                msg.payload = result.rows;
                node.send(msg);
                return;
            } catch (err) {
                lastErr = err;

                if (attempt === 1 && allowRetry && isRetryable(err)) {
                    await new Promise(r => setTimeout(r, 200));
                    continue;
                }
                handleError(err, msg, node);
                return;
            } finally {
                if (client) {
                    if (lastErr) client.release(lastErr);
                    else client.release();
                }
            }
        }
    }

    // Helper function to handle errors and send error messages
    function handleError(err, msg, node) {
        node.error(`PostgreSQL error: ${err.message}`, msg);
        msg.payload = { error: err.message };
        node.send(msg);
    }

    // Node responsible for executing SQL queries
    function PostgresNode(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        const configNode = RED.nodes.getNode(n.postgresdb);
        if (!configNode) {
            node.error('Postgres database config node is missing');
            return;
        }
        let pool = null;
        let poolKey = '';
        let lastMissingSignature = '';
        let lastMissingWarnAt = 0;

        const defaultPoolOptions = {
            max: 20,
            idleTimeoutMillis: 10000,
            connectionTimeoutMillis: 30000
        };

        node.on('input', async (msg) => {
            try {
                // Get configuration with context resolution
                const config = configNode.getConfig(msg, node);

                if (config._missing && config._missing.length) {
                    const signature = config._missing.join(',');
                    const now = Date.now();
                    if (signature !== lastMissingSignature || now - lastMissingWarnAt > 10000) {
                        node.warn(`Postgres config missing in context: ${signature}`, msg);
                        lastMissingSignature = signature;
                        lastMissingWarnAt = now;
                    }
                    node.status({ fill: 'yellow', shape: 'ring', text: `missing config: ${signature}` });
                    return;
                }

                node.status({});

                // Validate password
                if (config.password === null || config.password === undefined) {
                    node.error('Password is null or undefined', msg);
                    return;
                }

                const defaultConfig = {
                    user: config.user,
                    password: config.password,
                    host: config.hostname,
                    port: config.port,
                    database: config.db,
                };

                const allConnectings = RED.settings.get('pgConnects') || {};
                const connectName = msg.connectName;

                const useCustom = connectName && allConnectings[connectName];

                const effective = useCustom ? allConnectings[connectName] : {
                    user: defaultConfig.user,
                    password: defaultConfig.password,
                    host: defaultConfig.host,
                    port: defaultConfig.port,
                    database: defaultConfig.database,
                    ssl: config.ssl,
                    ignore_check_ssl: config.ignore_check_ssl,
                    ssl_path: config.ssl_path
                };
                const toInt = (value, fallback) => {
                    const parsed = parseInt(value, 10);
                    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
                };
                const poolOptions = {
                    max: toInt(
                        useCustom && effective.max !== undefined ? effective.max : config.pool_max,
                        defaultPoolOptions.max
                    ),
                    idleTimeoutMillis: toInt(
                        useCustom && effective.idleTimeoutMillis !== undefined
                            ? effective.idleTimeoutMillis
                            : config.pool_idle_timeout,
                        defaultPoolOptions.idleTimeoutMillis
                    ),
                    connectionTimeoutMillis: toInt(
                        useCustom && effective.connectionTimeoutMillis !== undefined
                            ? effective.connectionTimeoutMillis
                            : config.pool_connection_timeout,
                        defaultPoolOptions.connectionTimeoutMillis
                    )
                };

                if (useCustom) {
                    const missing = [];
                    if (!effective.host) missing.push('host');
                    if (!effective.port) missing.push('port');
                    if (!effective.database) missing.push('database');
                    if (!effective.user) missing.push('user');
                    if (!effective.password) missing.push('password');
                    if (missing.length) {
                        node.error(`pgConnects[${connectName}] missing fields: ${missing.join(', ')}`, msg);
                        return;
                    }
                }

                const newKey = JSON.stringify({
                    host: effective.host,
                    port: effective.port,
                    db: effective.database,
                    user: effective.user,
                    ssl: !!effective.ssl,
                    ignore: !!effective.ignore_check_ssl,
                    ca: effective.ssl_path || ''
                });

                if (msg.forceReconnect === true && pool) {
                    try { await pool.end(); } catch(e) {}
                    pool = null;
                    poolKey = '';
                }
                if (msg.forceReconnect === true && effective.ssl_path) {
                    caCache.delete(effective.ssl_path);
                }
                if (!pool || poolKey !== newKey) {
                    if (pool) {
                        try {
                            await pool.end();
                        } catch (e) {
                        }
                    }
                    poolKey = newKey;

                    // ssl_conf для effective
                    let effSslConf = false;
                    if (effective.ssl === true) {
                        if (effective.ignore_check_ssl === true) {
                            effSslConf = {rejectUnauthorized: false};
                        } else {
                            effSslConf = {rejectUnauthorized: true};
                            if (effective.ssl_path) {
                                try {
                                    if (!caCache.has(effective.ssl_path)) {
                                        caCache.set(effective.ssl_path, fs.readFileSync(effective.ssl_path).toString());
                                    }
                                    effSslConf.ca = caCache.get(effective.ssl_path);
                                } catch (certErr) {
                                    node.error(`Failed to read SSL certificate from path: ${effective.ssl_path}. Error: ${certErr.message}`, msg);
                                    return;
                                }
                            }
                        }
                    }

                    pool = new Pool({
                        user: effective.user,
                        password: effective.password,
                        host: effective.host,
                        port: effective.port,
                        database: effective.database,
                        ssl: effSslConf,
                        ...poolOptions
                    });

                    pool.on('connect', (client) => {
                        try { named.patch(client); } catch (e) {}
                    });
                    pool.on('error', (err) => node.warn(`PG pool error: ${err.message}`));
                }

                if (!pool) {
                    node.error('PostgreSQL pool is not initialized', msg);
                    return;
                }
                await executeQuery(pool, msg, node);
            } catch (err) {
                handleError(err, msg, node);
            }
        });

        node.on('close', async () => {
            if (pool) {
                try {
                    await pool.end();
                } catch (e) {
                }
            }
        });
    }
    RED.nodes.registerType('postgres', PostgresNode);
};