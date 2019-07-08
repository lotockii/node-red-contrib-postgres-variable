## node-red-contrib-postgres-variable

A [Node-RED](http://nodered.org) node to query [PostgreSQL](http://www.postgresql.org/).

    Edited by Andrii Lototskyi

### Install

Run the following command in the root directory of your Node-RED install

    npm install node-red-contrib-postgres-variable

 The node-red postgres node uses a template node to set the query and uses msg.queryParameters as params for the query.
 Each property in msg.queryParameters can be used as $propertyName in the query, see the 'setup params' and 'format query' node in the example.
 The msg it then passed to the postgres node.
 If you want the output of the query, check the 'Receive output' box in the postgres node.
 The result of the query is then set on the msg.payload property which can be sent to a http node.
 Data for connection can be obtained from the file settings.js

### Set Credentials

   add data to settings.js

    pgConnects: {
        connect1: {
            user: "usernameToDB",
            password: "userPasswordToDB",
            host: "hostName",
            port: "port",
            database: "dataBaseName",
            ssl: false // true/false
         },
        connect2 {
            user: "usernameToDB",
            password: "userPasswordToDB",
            host: "hostName",
            port: "port",
            database: "dataBaseName",
            ssl: false // true/false
        },
        connect3 {
            user: "usernameToDB",
            password: "userPasswordToDB",
            host: "hostName",
            port: "port",
            database: "dataBaseName",
            ssl: false // true/false
        }
    },


### Example For Request

   set data in function node

    msg.payload = "SELECT NOW()";
    msg.connectName = 'connect1';  // connect name from settings.js
    return msg;

### Example DB

    CREATE TABLE public.table1
    (
        field1 character varying,
        field2 integer
    )
    WITH (
        OIDS=FALSE
    );
    ALTER TABLE public.table1
      OWNER TO postgres;

    INSERT INTO public.table1(
                field1, field2)
        VALUES ('row1',1);
    INSERT INTO public.table1(
                field1, field2)
        VALUES ('row2',2);

### Example node-red flow

Import the flow below in an empty sheet in nodered

    [{"id":"35c76478.e1723c","type":"function","z":"25b7c5b4.6f1eba","name":"setup params","func":"msg.queryParameters = msg.queryParameters || {};\nmsg.queryParameters.param1 = 1;\nmsg.connectName = 'connect1';\nreturn msg;","outputs":1,"noerr":0,"x":273,"y":96,"wires":[["740c574e.518e28"]]}]
