const mongoose = require("mongoose");

const app = require("./app");
const http = require("http");

const server = http.createServer(app);


require('dotenv').config({ path: './config.env' });

// Connect to MongoDB

// local
mongoose.connect('mongodb://localhost:27017/chatapp')
.then(
    (conn) => {
        console.log('MongoDB Connection successful.\nHost:',conn.connections[0].host,'\nDatabase Port:',conn.connections[0].port,'\nDatabase Name:',conn.connections[0].name);
    }
)
    .catch(err => console.error('MongoDB connection error: ', err));

// online
// const dbUrl = process.env.DATABASE.replace(
//     "<PASSWORD>",
//     process.env.DATABASE_PASSWORD
// );
// mongoose.connect(dbUrl,
//     {
//         useNewUrlParser: true, // The underlying MongoDB driver has deprecated their current connection string parser. Because this is a major change, they added the useNewUrlParser flag to allow users to fall back to the old parser if they find a bug in the new parser.
//         useUnifiedTopology: true, // Set to true to opt in to using the MongoDB driver's new connection management engine. You should set this option to true , except for the unlikely case that it prevents you from maintaining a stable connection.
//     }).then((conn) => {
//         console.log('MongoDB Connection successful.\nHost:',conn.connections[0].host,'\nDatabase Port:',conn.connections[0].port,'\nDatabase Name:',conn.connections[0].name);
//     })
//     .catch(err => console.error('MongoDB connection error: ', err));


const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});