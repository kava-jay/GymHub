require('dotenv').config();
const cookieParser = require('cookie-parser');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 5000;

// 1. Middleware Order
app.use(cookieParser()); 
app.use(cors({
    origin: 'https://gym-hub-pi.vercel.app',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true // Important for cookies
}));
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Database Connection
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("❌ FATAL ERROR: MONGO_URI is missing.");
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('✅ Connected to MongoDB'))
        .catch(err => console.error('❌ MongoDB Connection Error:', err));
}

// --- SCHEMAS ---
const memberSchema = new mongoose.Schema({
    name: { type: String, required: true },
    age: { type: Number, required: true },
    weight: { type: Number, required: true },
    mobileNumber: { type: String, required: true },
    address: { type: String, required: true },
    amount: { type: Number, required: true },
    joinedDate: { type: String, required: true },
    duration: { type: Number, required: true },
    expiryDate: { type: String, required: true },
    photo: { type: String, default: '' },
    history: [{ duration: Number, joinedDate: String, expiryDate: String, amount: Number }]
}, { timestamps: true });

const Member = mongoose.model('Member', memberSchema);
const DeletedLog = mongoose.model('DeletedLog', new mongoose.Schema({ name: String, dateDeleted: { type: Date, default: Date.now } }));

// --- AUTHENTICATION MIDDLEWARE ---
const checkAuth = (req, res, next) => {
    // Allow access to login page and login API without auth
    if (req.path === '/login.html' || req.path === '/api/login' || req.path === '/api/logout') {
        return next();
    }

    const token = req.cookies.auth_token;

    if (token === 'gymhub_admin_secret') {
        next(); // User is logged in
    } else {
        // User is NOT logged in -> Force redirect to login
        if (req.path.startsWith('/api')) {
            // If trying to access API data without auth, send 401 instead of redirect
            return res.status(401).json({ message: 'Unauthorized' });
        }
        res.redirect('/login.html');
    }
};

// --- AUTHENTICATION ROUTES ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === 'admin' && password === 'gymhubadmin') {
        // Session Cookie (No maxAge = Dies when browser closes)
        res.cookie('auth_token', 'gymhub_admin_secret', { 
            httpOnly: true,
            sameSite: 'lax', // 'lax' allows redirects to work better across domains than 'strict'
            secure: process.env.NODE_ENV === 'production' // Ensures cookie only sent over HTTPS
        });
        return res.json({ success: true });
    } else {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ success: true });
});

// --- PROTECTED ROUTES (Pages) ---

// 1. Serve Login Page (No auth required)
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 2. Serve Dashboard (Auth Required)
app.get('/', checkAuth, (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', checkAuth, (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- PROTECTED API ROUTES (Data) ---
// Added checkAuth to all API routes to prevent fetching data without logging in

app.get('/api/members', checkAuth, async (req, res) => {
    try {
        const members = await Member.find().sort({ createdAt: -1 });
        res.json(members);
    } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post('/api/members', checkAuth, async (req, res) => {
    try {
        const newMember = new Member(req.body);
        const savedMember = await newMember.save();
        res.status(201).json(savedMember);
    } catch (err) { res.status(400).json({ message: err.message }); }
});

app.put('/api/members/:id', checkAuth, async (req, res) => {
    try {
        const id = req.params.id;
        const existingMember = await Member.findById(id);
        const newDetails = req.body;

        if (!existingMember) return res.status(404).json({ message: "Member not found" });

        if (existingMember.joinedDate !== newDetails.joinedDate) {
            existingMember.history.push({
                duration: existingMember.duration,
                joinedDate: existingMember.joinedDate,
                expiryDate: existingMember.expiryDate,
                amount: existingMember.amount
            });
        }

        existingMember.name = newDetails.name;
        existingMember.age = newDetails.age;
        existingMember.weight = newDetails.weight;
        existingMember.mobileNumber = newDetails.mobileNumber;
        existingMember.address = newDetails.address;
        existingMember.amount = newDetails.amount;
        existingMember.joinedDate = newDetails.joinedDate;
        existingMember.duration = newDetails.duration;
        existingMember.expiryDate = newDetails.expiryDate;
        if(newDetails.photo) existingMember.photo = newDetails.photo;

        const updatedMember = await existingMember.save();
        res.json(updatedMember);
    } catch (err) { res.status(400).json({ message: err.message }); }
});

app.delete('/api/members/:id', checkAuth, async (req, res) => {
    try {
        const member = await Member.findById(req.params.id);
        if (member) await DeletedLog.create({ name: member.name });
        await Member.findByIdAndDelete(req.params.id);
        res.json({ message: 'Member deleted' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

app.get('/api/stats', checkAuth, async (req, res) => {
    const { month, year } = req.query;
    const monthNum = parseInt(month);
    const yearNum = parseInt(year);

    try {
        const startDate = new Date(yearNum, monthNum, 1);
        const endDate = new Date(yearNum, parseInt(monthNum) + 1, 0, 23, 59, 59);

        // FIX: Convert Date objects to Strings ('YYYY-MM-DD') to match the Schema type for joinedDate
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];

        // New Members logic remains based on createdAt (when they were added to system)
        const newMembers = await Member.countDocuments({ createdAt: { $gte: startDate, $lte: endDate } });
        
        const membersLeft = await DeletedLog.countDocuments({ dateDeleted: { $gte: startDate, $lte: endDate } });
        
        // --- REVENUE FIX STARTS HERE ---
        // We changed 'createdAt' to 'joinedDate' and used string variables (startDateStr/endDateStr)
        const revenueResult = await Member.aggregate([
            { $match: { joinedDate: { $gte: startDateStr, $lte: endDateStr } } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        // --- REVENUE FIX ENDS HERE ---

        const revenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

        const todayStr = new Date().toISOString().split('T')[0];

        const totalActive = await Member.countDocuments({ expiryDate: { $gte: todayStr } });
        const totalExpired = await Member.countDocuments({ expiryDate: { $lt: todayStr } });

        res.json({ newMembers, membersLeft, revenue, totalActive, totalExpired });
    } catch (err) {
        console.error("Dashboard Stats Error:", err);
        res.status(500).json({ message: "Error calculating stats" });
    }
});

// --- STATIC FILES (MOVED TO BOTTOM) ---
// This ensures that specific routes above are checked first.
app.use(express.static(path.join(__dirname, 'public')));

// --- SERVER START ---
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`🚀 Server running locally on http://localhost:${PORT}`));
}

module.exports = app;