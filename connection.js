// connection.js
const mysql = require("mysql2");
const util = require("util");

// Create MySQL connection
const connection = mysql.createConnection({
  host: process.env.DB_HOST || 'sql12.freesqldatabase.com',
  user: process.env.DB_USER || 'sql12803617',
  password: process.env.DB_PASSWORD || 'BKQ7Xg4deM',
  database: process.env.DB_NAME || 'sql12803617',
});

// Connect to database
connection.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err.message);
  } else {
    console.log('Connected to MySQL database');
  }
});

// Promisify query for promise-based operations
const queryAsync = util.promisify(connection.query).bind(connection);

// Export the connection object and promisified query function
module.exports = {
  connection,
  query: queryAsync
};
