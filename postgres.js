const { Pool } = require('pg');
const named = require('node-postgres-named');

module.exports = function (RED) {  // Изменили export на module.exports
    // GET request to retrieve the credentials for a specific Postgres node
    RED.httpAdmin.get('/postgresdb/:id', async (req, res) => {
        try {
            const credentials = RED.nodes.getCredentials(req.params.id);
            res.json({
                user: credentials?.user,
                hasPassword: !!(credentials?.password), // returns true if password exists
            });
        } catch (err) {
            res.status(500).send('Error fetching credentials');
        }
    });

    // DELETE request to delete the credentials for a specific Postgres node
    RED.httpAdmin.delete('/postgresdb/:id', (req, res) => {
        try {
            RED.nodes.deleteCredentials(req.params.id);
            res.status(200).send();
        } catch (err) {
            res.status(500).send('Error deleting credentials');
        }
    });

    // POST request to save credentials for a specific Postgres node
    RED.httpAdmin.post('/postgresdb/:id', async (req, res) => {
        try {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                // Parse body using URLSearchParams
                const newCreds = new URLSearchParams(body);
                let credentials = RED.nodes.getCredentials(req.params.id) || {};
                // Get user and password from URLSearchParams
                credentials.user = newCreds.get('user') || credentials.user;
                credentials.password = newCreds.get('password') || credentials.password;
                RED.nodes.addCredentials(req.params.id, credentials);
                res.status(200).send();
            });
        } catch (err) {
            res.status(500).send('Error saving credentials');
        }
    });

    // Definition of a Postgres database configuration node
    function PostgresDatabaseNode(n) {
        RED.nodes.createNode(this, n);
        const credentials = this.credentials || {};
        this.hostname = n.hostname;
        this.port = n.port;
        this.db = n.db;
        this.ssl = n.ssl;
        this.user = credentials.user;
        this.password = credentials.password;
    }

    RED.nodes.registerType('postgresdb', PostgresDatabaseNode, {
        credentials: {
            user: { type: 'text' },
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
        const defaultConfig = {
            user: configNode.user,          // Default username
            password: configNode.password,  // Default password
            host: configNode.hostname,      // Default host
            port: configNode.port,          // Default port
            database: configNode.db,        // Default database
            ssl: configNode.ssl,            // Default SSL setting
            idleTimeoutMillis: 500,
            connectionTimeoutMillis: 3000
        };
        const allConnectings = RED.settings.get('pgConnects') || {}; // Get all connections from Node-RED settings
        node.on('input', async (msg) => {
            let pool;
            const connectName = msg.connectName;

            // If connection name is provided, use it; otherwise, use the default connection
            if (connectName && allConnectings[connectName]) {
                const customConfig = allConnectings[connectName]; // Get configuration for the specified connection
                pool = new Pool({
                    user: customConfig.user,
                    password: customConfig.password,
                    host: customConfig.host,
                    port: customConfig.port,
                    database: customConfig.database,
                    ssl: customConfig.ssl,
                    idleTimeoutMillis: 500,
                    connectionTimeoutMillis: 3000
                });
            } else {
                // If no connection name is provided or found, use default config
                pool = new Pool(defaultConfig);
            }

            // Execute the query using the connection pool
            await executeQuery(pool, msg, node);
        });

        node.on('close', () => {
            if (pool) pool.end(); // Close the connection pool when the node is closed
        });
    }

    RED.nodes.registerType('postgres', PostgresNode);
};