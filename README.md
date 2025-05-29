# Node-RED PostgreSQL Variable Context Module

A Node-RED module for PostgreSQL database operations with support for dynamic configuration from different contexts (flow, global, environment variables).

    Edited by Andrii Lototskyi

## Features

- **Dynamic Configuration**: Get database connection parameters from different contexts:
  - String values (direct input)
  - Flow context variables
  - Global context variables  
  - Environment variables
- **SSL Support**: Full SSL configuration with certificate validation options
- **Named Parameters**: Support for named query parameters using node-postgres-named
- **Connection Pooling**: Efficient connection management with PostgreSQL connection pools
- **Error Handling**: Comprehensive error handling and reporting

## Installation

```bash
npm install node-red-contrib-postgres-variable
```

## Configuration

### Database Configuration Node

The PostgreSQL database configuration node supports the following parameters, each can be sourced from different contexts:

#### Connection Parameters

| Parameter | Description | Context Types | Default |
|-----------|-------------|---------------|---------|
| **Host** | PostgreSQL server hostname | str, flow, global, env | localhost |
| **Port** | PostgreSQL server port | str, flow, global, env | 5432 |
| **Database** | Database name | str, flow, global, env | - |
| **Username** | Database username | str, flow, global, env | - |
| **Password** | Database password | str, flow, global, env | - |

> **🔐 Password Security Note**: When password type is set to "str" (string), the password is securely stored in Node-RED's credentials system and displayed as a password field (hidden). For other types (flow, global, env), the password reference is stored in the flow configuration for portability.

#### SSL Parameters

| Parameter | Description | Context Types | Default |
|-----------|-------------|---------------|---------|
| **SSL** | Enable SSL connection | bool, flow, global, env | false |
| **Ignore SSL Certificate** | Skip certificate validation | bool, flow, global, env | false |
| **SSL Certificate Path** | Path to SSL certificate file | str, flow, global, env | - |

### Context Types

- **str**: Direct string value
- **flow**: Value from flow context (`flow.get(key)`)
- **global**: Value from global context (`global.get(key)`)
- **env**: Value from environment variable (`process.env[key]`)
- **bool**: Boolean value (for SSL options)

## Usage Examples

### Basic Usage

1. **Configure Database Node**:
   - Host: `localhost` (string)
   - Port: `5432` (string)
   - Database: `mydb` (string)
   - Username: `postgres` (string)
   - Password: `secret` (string)

2. **Use in Flow**:
   ```javascript
   msg.payload = "SELECT * FROM users WHERE id = $userId";
   msg.queryParameters = { userId: 123 };
   return msg;
   ```

### Dynamic Configuration from Context

#### Using Flow Context
```javascript
// Set in a function node before the postgres node
flow.set("db_host", "production-server");
flow.set("db_name", "prod_database");
```

Configure database node:
- Host: `db_host` (flow context)
- Database: `db_name` (flow context)

#### Using Global Context
```javascript
// Set in a function node
global.set("postgres_port", "5433");
global.set("postgres_user", "admin");
```

Configure database node:
- Port: `postgres_port` (global context)
- Username: `postgres_user` (global context)

#### Using Environment Variables
Set environment variables:
```bash
export DB_HOST=production-server
export DB_PORT=5432
export DB_NAME=production_db
export DB_USER=prod_user
export DB_PASSWORD=secure_password
```

Configure database node:
- Host: `DB_HOST` (environment)
- Port: `DB_PORT` (environment)
- Database: `DB_NAME` (environment)
- Username: `DB_USER` (environment)
- Password: `DB_PASSWORD` (environment)

### SSL Configuration Examples

#### SSL with Certificate Validation
```javascript
// Environment variables
export SSL_ENABLED=true
export SSL_CERT_PATH=/path/to/certificate.pem
```

Configure database node:
- SSL: `SSL_ENABLED` (environment) → `true`
- Ignore SSL Certificate: `false` (boolean)
- SSL Certificate Path: `SSL_CERT_PATH` (environment) → `/path/to/certificate.pem`

#### SSL without Certificate Validation
Configure database node:
- SSL: `true` (boolean)
- Ignore SSL Certificate: `true` (boolean)

#### Dynamic SSL from Flow Context
```javascript
// In a function node
flow.set("use_ssl", true);
flow.set("ignore_cert", false);
flow.set("cert_path", "/secure/path/cert.pem");
```

Configure database node:
- SSL: `use_ssl` (flow context)
- Ignore SSL Certificate: `ignore_cert` (flow context)
- SSL Certificate Path: `cert_path` (flow context)

## Query Examples

### Simple Query
```javascript
msg.payload = "SELECT * FROM users";
return msg;
```

### Parameterized Query
```javascript
msg.payload = "SELECT * FROM users WHERE age > $minAge AND city = $userCity";
msg.queryParameters = {
    minAge: 18,
    userCity: "New York"
};
return msg;
```

### Insert with Parameters
```javascript
msg.payload = "INSERT INTO users (name, email, age) VALUES ($name, $email, $age)";
msg.queryParameters = {
    name: "John Doe",
    email: "john@example.com",
    age: 30
};
return msg;
```

### Dynamic Query from Message
```javascript
msg.payload = "SELECT * FROM " + msg.tableName + " WHERE id = $recordId";
msg.queryParameters = {
    recordId: msg.payload.id
};
return msg;
```

## Custom Connection Configuration

You can also define custom connection configurations in Node-RED settings.js:

```javascript
module.exports = {
    // ... other settings
    pgConnects: {
        "production": {
            user: "prod_user",
            password: "prod_password",
            host: "prod-server",
            port: 5432,
            database: "production_db",
            ssl: true,
            ignore_check_ssl: false,
            ssl_path: "/path/to/prod-cert.pem"
        },
        "development": {
            user: "dev_user",
            password: "dev_password",
            host: "localhost",
            port: 5432,
            database: "dev_db",
            ssl: false
        }
    }
};
```

Use custom connection:
```javascript
msg.connectName = "production"; // or "development"
msg.payload = "SELECT * FROM users";
return msg;
```

## Password Security

The module implements intelligent password handling based on the selected type:

### String Passwords (Secure Storage)
When password type is set to **"str"**:
- Password is stored in Node-RED's encrypted credentials system
- Input field is automatically masked with dots/asterisks (password type)
- Password is not visible in flow exports
- Field dynamically switches to hidden mode when "str" type is selected
- Ideal for static passwords in production environments

### Context Passwords (Portable Configuration)
When password type is set to **"flow"**, **"global"**, or **"env"**:
- Only the reference key is stored in flow configuration
- Input field shows plain text for easy editing of context keys
- Actual password value is resolved at runtime from the specified context
- Flow can be exported/imported without exposing passwords
- Field automatically switches to text mode for visibility of context references
- Ideal for dynamic environments and CI/CD deployments

### Example Scenarios

#### Production with Static Password
```javascript
// Configuration: Password type = "str", value = "mySecretPassword"
// Result: Password stored securely in credentials, not in flow
```

#### Development with Environment Variable
```javascript
// Configuration: Password type = "env", value = "DB_PASSWORD"
// Environment: DB_PASSWORD=dev_password_123
// Result: Password resolved from environment at runtime
```

#### Dynamic Password from Global Context
```javascript
// In a function node:
global.set("current_db_password", "dynamic_password_" + Date.now());

// Configuration: Password type = "global", value = "current_db_password"
// Result: Password resolved from global context at runtime
```

## Error Handling

The module provides comprehensive error handling:

```javascript
// Errors are sent to the node's error output
// and also attached to the message
if (msg.payload.error) {
    node.warn("Database error: " + msg.payload.error);
    return null; // Stop processing
}
```

## SSL Configuration Logic

The SSL configuration follows this logic:

1. **SSL = false**: No SSL connection
2. **SSL = true + Ignore SSL Certificate = true**: SSL connection without certificate validation
3. **SSL = true + Ignore SSL Certificate = false**: SSL connection with certificate validation
4. **SSL = true + Ignore SSL Certificate = false + SSL Certificate Path**: SSL with custom certificate

## Migration from Previous Versions

If you're upgrading from a previous version that used Node-RED credentials:

1. **Username and Password**: Now configured through typedInput fields instead of credentials
2. **All Fields**: Now support context resolution (flow, global, env)
3. **SSL Configuration**: Enhanced with better boolean handling and certificate path options

## Dependencies

- `pg`: PostgreSQL client for Node.js
- `node-postgres-named`: Named parameter support for node-postgres

## License

Apache License 2.0

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues and questions, please use the GitHub issue tracker.
