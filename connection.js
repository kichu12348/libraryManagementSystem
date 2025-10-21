// connection.js
const mysql = require("mysql2");
const util = require("util");

// Create MySQL connection
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Connect to database
connection.connect((err) => {
  if (err) {
    console.error("Error connecting to MySQL:", err.message);
  } else {
    console.log("Connected to MySQL database");
  }
});

// Promisify query for promise-based operations
const queryAsync = util.promisify(connection.query).bind(connection);

// Export the connection object and promisified query function
module.exports = {
  connection,
  query: queryAsync,
};
