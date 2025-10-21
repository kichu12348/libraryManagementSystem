const express = require("express");
const bcrypt = require("bcrypt");
const session = require("express-session");
const path = require("path");
const app = express();
const port = process.env.PORT || 3000;

// Import MySQL connection and query function
const { connection, query } = require("./connection");

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: "library-management-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 }, // 1 hour
  })
);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.json());

// Drop existing tables and recreate them on startup
const initializeDatabase = async () => {
  try {
    // Drop tables if they exist
    await query("DROP TABLE IF EXISTS Books");
    await query("DROP TABLE IF EXISTS Users");

    console.log("Dropped existing tables");

    // Create Users table
    await query(`
      CREATE TABLE Users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'member'
      )
    `);

    // Create Books table
    await query(`
      CREATE TABLE Books (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        author VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'Available',
        borrowed_by_user_id INT,
        due_date VARCHAR(20),
        FOREIGN KEY (borrowed_by_user_id) REFERENCES Users(id)
      )
    `);

    console.log("Created fresh tables");

    // Seed admin user
    console.log("Seeding admin user...");
    const saltRounds = 10;
    const adminHash = await bcrypt.hash("admin123", saltRounds);

    const adminResult = await query(
      "INSERT INTO Users (username, password, role) VALUES (?, ?, ?)",
      ["admin", adminHash, "admin"]
    );
    console.log("Admin user created with ID:", adminResult.insertId);

    const checkUser = await query("SELECT * FROM Users;");
    console.log(checkUser);

    // Always seed Books table
    console.log("Seeding books...");
    const sampleBooks = [
      { title: "1984", author: "George Orwell" },
      { title: "Dune", author: "Frank Herbert" },
      { title: "The Hobbit", author: "J.R.R. Tolkien" },
      { title: "To Kill a Mockingbird", author: "Harper Lee" },
      { title: "The Great Gatsby", author: "F. Scott Fitzgerald" },
      { title: "Pride and Prejudice", author: "Jane Austen" },
      { title: "The Catcher in the Rye", author: "J.D. Salinger" },
      { title: "Brave New World", author: "Aldous Huxley" },
      { title: "The Lord of the Rings", author: "J.R.R. Tolkien" },
      { title: "Animal Farm", author: "George Orwell" },
    ];

    for (const book of sampleBooks) {
      const result = await query(
        "INSERT INTO Books (title, author) VALUES (?, ?)",
        [book.title, book.author]
      );
      console.log(`Book "${book.title}" created with ID:`, result.insertId);
    }

    console.log("Database seeding complete!");
  } catch (error) {
    console.error("Error initializing database:", error);
  }
};

// Initialize the database
initializeDatabase();

// Middleware functions
const isLoggedIn = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.redirect("/login");
  }
};

const isAdmin = (req, res, next) => {
  if (req.session.role === "admin") {
    next();
  } else {
    res.status(403).send("Forbidden: Admin access required");
  }
};

// Auth Routes (No middleware)

// Login page
app.get("/login", (req, res) => {
  res.render("login");
});

// Register page
app.get("/register", (req, res) => {
  res.render("register");
});

// Register post
app.post("/register", async (req, res) => {
  const { username, password } = req.body;

  // Validate input
  if (!username || !password) {
    return res.status(400).send("Username and password are required");
  }

  try {
    // Hash password
    const hash = await bcrypt.hash(password, 10);

    // Insert new user
    await query(
      "INSERT INTO Users (username, password, role) VALUES (?, ?, ?)",
      [username, hash, "member"]
    );

    res.redirect("/login");
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).send("Username already exists");
    }
    console.error("Error creating user:", err.message);
    return res.status(500).send("Error creating user");
  }
});

// Login post
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  // Validate input
  if (!username || !password) {
    return res.status(400).send("Username and password are required");
  }

  try {
    // Find user
    const [user] = await query("SELECT * FROM Users WHERE username = ?", [
      username,
    ]);

    if (!user) {
      return res.status(401).send("Invalid username or password");
    }

    // Check password
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).send("Invalid username or password");
    }

    // Set session
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;

    res.redirect("/");
  } catch (err) {
    console.error("Error during login:", err.message);
    return res.status(500).send("Error during login");
  }
});

// Logout
app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error during logout:", err.message);
      return res.status(500).send("Error during logout");
    }
    res.redirect("/login");
  });
});

// App Routes (Protected by isLoggedIn)

// Dashboard
app.get("/", isLoggedIn, async (req, res) => {
  const userId = req.session.userId;
  const userRole = req.session.role;

  try {
    // Fetch all books with borrower info
    const books = await query(`
      SELECT Books.*, Users.username as borrower_username 
      FROM Books 
      LEFT JOIN Users ON Books.borrowed_by_user_id = Users.id
    `);

    // Calculate fines for overdue books
    const today = new Date();
    books.forEach((book) => {
      if (book.due_date) {
        const dueDate = new Date(book.due_date);
        if (today > dueDate) {
          const diffTime = Math.abs(today - dueDate);
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          book.fine = diffDays * 5; // $5 per day
        }
      }
    });

    // Filter books borrowed by the current user for "My Books" section
    const myBooks =
      userRole !== "admin"
        ? books.filter((book) => book.borrowed_by_user_id === userId)
        : [];

    res.render("index", {
      books,
      myBooks,
      user: {
        id: userId,
        username: req.session.username,
        role: userRole,
      },
    });
  } catch (err) {
    console.error("Error fetching books:", err.message);
    return res.status(500).send("Error fetching books");
  }
});

// Borrow book
app.post("/borrow/:id", isLoggedIn, async (req, res) => {
  const bookId = req.params.id;
  const userId = req.session.userId;
  const userRole = req.session.role;

  // Check if user is an admin - admins can't borrow books
  if (userRole === "admin") {
    return res
      .status(403)
      .send("Admins cannot borrow books. Please use a member account.");
  }

  try {
    // Calculate due date (30 days from now)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    const dueDateString = dueDate.toISOString().split("T")[0]; // Format as YYYY-MM-DD

    // Update book status
    await query(
      "UPDATE Books SET status = ?, borrowed_by_user_id = ?, due_date = ? WHERE id = ?",
      ["Borrowed", userId, dueDateString, bookId]
    );

    res.redirect("/");
  } catch (err) {
    console.error("Error borrowing book:", err.message);
    return res.status(500).send("Error borrowing book");
  }
});

// Return book
app.post("/return/:id", isLoggedIn, async (req, res) => {
  const bookId = req.params.id;
  const userId = req.session.userId;
  const isAdmin = req.session.role === "admin";

  try {
    // Find book
    const [books] = await query("SELECT * FROM Books WHERE id = ?", [bookId]);
    const book = books[0];

    if (!book) {
      return res.status(404).send("Book not found");
    }

    // Auth check
    if (!isAdmin && book.borrowed_by_user_id !== userId) {
      return res.status(403).send("You are not authorized to return this book");
    }

    // Update book status
    await query(
      "UPDATE Books SET status = ?, borrowed_by_user_id = NULL, due_date = NULL WHERE id = ?",
      ["Available", bookId]
    );

    res.redirect("/");
  } catch (err) {
    console.error("Error returning book:", err.message);
    return res.status(500).send("Error returning book");
  }
});

// Admin Routes (Protected by isLoggedIn AND isAdmin)

// Admin dashboard
app.get("/admin", isLoggedIn, isAdmin, (req, res) => {
  res.render("admin", {
    user: {
      id: req.session.userId,
      username: req.session.username,
      role: req.session.role,
    },
  });
});

// Add book
app.post("/admin/addbook", isLoggedIn, isAdmin, async (req, res) => {
  const { title, author } = req.body;

  // Validate input
  if (!title || !author) {
    return res.status(400).send("Title and author are required");
  }

  try {
    // Insert book
    await query("INSERT INTO Books (title, author) VALUES (?, ?)", [
      title,
      author,
    ]);

    res.redirect("/admin");
  } catch (err) {
    console.error("Error adding book:", err.message);
    return res.status(500).send("Error adding book");
  }
});

// Edit book form
app.get("/admin/edit/:id", isLoggedIn, isAdmin, async (req, res) => {
  const bookId = req.params.id;

  try {
    const [book] = await query("SELECT * FROM Books WHERE id = ?", [bookId]);

    if (!book) {
      return res.status(404).send("Book not found");
    }

    res.render("edit-book", {
      book,
      user: {
        id: req.session.userId,
        username: req.session.username,
        role: req.session.role,
      },
    });
  } catch (err) {
    console.error("Error fetching book:", err.message);
    return res.status(500).send("Error fetching book details");
  }
});

// Update book
app.post("/admin/edit/:id", isLoggedIn, isAdmin, async (req, res) => {
  const bookId = req.params.id;
  const { title, author } = req.body;

  // Validate input
  if (!title || !author) {
    return res.status(400).send("Title and author are required");
  }

  try {
    await query("UPDATE Books SET title = ?, author = ? WHERE id = ?", [
      title,
      author,
      bookId,
    ]);

    res.redirect("/");
  } catch (err) {
    console.error("Error updating book:", err.message);
    return res.status(500).send("Error updating book");
  }
});

// Delete book
app.post("/admin/delete/:id", isLoggedIn, isAdmin, async (req, res) => {
  const bookId = req.params.id;

  try {
    await query("DELETE FROM Books WHERE id = ?", [bookId]);
    res.redirect("/");
  } catch (err) {
    console.error("Error deleting book:", err.message);
    return res.status(500).send("Error deleting book");
  }
});

// Home route redirect to dashboard or login
app.get("/", (req, res) => {
  if (req.session.userId) {
    res.redirect("/dashboard");
  } else {
    res.redirect("/login");
  }
});

// Start server
app.listen(port, () => {
  console.log(`Library Management System running on http://localhost:${port}`);
});
