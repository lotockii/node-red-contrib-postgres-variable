const { Pool } = require('pg');
const named = require('node-postgres-named');
const fs = require('fs');

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
        
        // Get credentials for string passwords
        const credentials = this.credentials || {};

        // Method to get configuration values with context resolution
        this.getConfig = function(msg, executingNode) {
            const config = {};
            
            // Parse values using separate type fields
            config.hostname = getValueFromContext(executingNode || this, this.hostname, this.hostnameType, msg) || 'localhost';
            config.port = parseInt(getValueFromContext(executingNode || this, this.port, this.portType, msg)) || 5432;
            config.db = getValueFromContext(executingNode || this, this.db, this.dbType, msg) || 'postgres';
            config.ssl = this.parseBooleanValue(this.ssl, this.sslType, msg, executingNode);
            config.ignore_check_ssl = this.parseBooleanValue(this.ignore_check_ssl, this.ignore_check_sslType, msg, executingNode);
            config.ssl_path = getValueFromContext(executingNode || this, this.ssl_path, this.ssl_pathType, msg);
            config.user = getValueFromContext(executingNode || this, this.user, this.userType, msg) || '';
            config.password = this.parsePasswordValue(msg, executingNode) || '';
            
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

    // Helper function to execute the database query
    async function executeQuery(pool, msg, node) {
        try {
            const client = await pool.connect();
            named.patch(client); // allows named query parameters with node-postgres-named
            const queryParams = msg.queryParameters || {};
            const result = await client.query(msg.payload, queryParams);
            msg.payload = result.rows; // output the result of the query
            node.send(msg);
            client.release();
        } catch (err) {
            handleError(err, msg, node);
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

        node.on('input', async (msg) => {
            try {
                // Get configuration with context resolution
                const config = configNode.getConfig(msg, node);
                
                // Validate password
                if (config.password === null || config.password === undefined) {
                    node.error('Password is null or undefined', msg);
                    return;
                }
                
                // Configure SSL
                let ssl_conf = false;
                if (config.ssl === true) {
                    if (config.ignore_check_ssl === true) {
                        // SSL enabled but ignore certificate validation
                        ssl_conf = { rejectUnauthorized: false };
                    } else {
                        // SSL enabled with certificate validation
                        ssl_conf = { rejectUnauthorized: true };
                        
                        // Add certificate if path is provided
                        if (config.ssl_path) {
                            try {
                                ssl_conf.ca = fs.readFileSync(config.ssl_path).toString();
                            } catch (certErr) {
                                node.error(`Failed to read SSL certificate from path: ${config.ssl_path}. Error: ${certErr.message}`, msg);
                                return;
                            }
                        }
                    }
                }

                const defaultConfig = {
                    user: config.user,
                    password: config.password,
                    host: config.hostname,
                    port: config.port,
                    database: config.db,
                    ssl: ssl_conf,
                    idleTimeoutMillis: 500,
                    connectionTimeoutMillis: 3000
                };

                const allConnectings = RED.settings.get('pgConnects') || {};
                const connectName = msg.connectName;
                let pool;

                if (connectName && allConnectings[connectName]) {
                    const customConfig = allConnectings[connectName];
                    let customSslConf = false;
                    if (customConfig.ssl === true) {
                        if (customConfig.ignore_check_ssl === true) {
                            customSslConf = { rejectUnauthorized: false };
                        } else {
                            customSslConf = { rejectUnauthorized: true };
                            if (customConfig.ssl_path) {
                                try {
                                    customSslConf.ca = fs.readFileSync(customConfig.ssl_path).toString();
                                } catch (certErr) {
                                    node.error(`Failed to read SSL certificate from custom config path: ${customConfig.ssl_path}. Error: ${certErr.message}`, msg);
                                    return;
                                }
                            }
                        }
                    }
                    pool = new Pool({
                        user: customConfig.user,
                        password: customConfig.password,
                        host: customConfig.host,
                        port: customConfig.port,
                        database: customConfig.database,
                        ssl: customSslConf,
                        idleTimeoutMillis: 500,
                        connectionTimeoutMillis: 3000
                    });
                } else {
                    pool = new Pool(defaultConfig);
                }

                await executeQuery(pool, msg, node);
            } catch (err) {
                handleError(err, msg, node);
            }
        });

        node.on('close', () => {
            if (pool) pool.end();
        });
    }

    RED.nodes.registerType('postgres', PostgresNode);
};