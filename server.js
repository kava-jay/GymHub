const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 5000;

// Middleware
// app.use(cors());
app.use(cors({
  origin: 'https://gym-hub-pi.vercel.app',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());

// app.use(express.json());
// Increase limit to 10mb to allow photos
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection
const MONGO_URI = 'mongodb+srv://GymHub_DB:upz9QI5SX5tlRbKD@cluster0.odvw3wn.mongodb.net/GymHubDB';
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB: GymHubDB'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- SCHEMAS ---

// 1. Member Schema
const memberSchema = new mongoose.Schema({
    name: { type: String, required: true },
    age: { type: Number, required: true },
    weight: { type: Number, required: true },
    mobileNumber: { type: String, required: true }, // NEW
    address: { type: String, required: true },    // NEW
    amount: { type: Number, required: true },
    joinedDate: { type: String, required: true },
    duration: { type: Number, required: true },
    expiryDate: { type: String, required: true },
    photo: { type: String, default: '' },
    history: [ // NEW: Array to store old plans
        { 
            duration: Number,
            joinedDate: String,
            expiryDate: String,
            amount: Number
        }
    ]
}, { timestamps: true });

const Member = mongoose.model('Member', memberSchema);

// 2. Deleted Log Schema (For Dashboard "Members Left")
const deletedLogSchema = new mongoose.Schema({
    name: String,
    dateDeleted: { type: Date, default: Date.now }
});

const DeletedLog = mongoose.model('DeletedLog', deletedLogSchema);

// --- API ROUTES ---

// 1. Get All Members
app.get('/api/members', async (req, res) => {
    try {
        const members = await Member.find().sort({ createdAt: -1 });
        res.json(members);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 2. Create Member
app.post('/api/members', async (req, res) => {
    try {
        const newMember = new Member(req.body);
        const savedMember = await newMember.save();
        res.status(201).json(savedMember);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// 3. Update Member
// 3. Update Member
app.put('/api/members/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const existingMember = await Member.findById(id);
        const newDetails = req.body;

        if (!existingMember) return res.status(404).json({ message: "Member not found" });

        // --- AUTO-ARCHIVE LOGIC ---
        // If Joined Date is changed (means starting a new plan), save old one to history
        if (existingMember.joinedDate !== newDetails.joinedDate) {
            existingMember.history.push({
                duration: existingMember.duration,
                joinedDate: existingMember.joinedDate,
                expiryDate: existingMember.expiryDate,
                amount: existingMember.amount
            });
        }

        // Update all fields
        existingMember.name = newDetails.name;
        existingMember.age = newDetails.age;
        existingMember.weight = newDetails.weight;
        existingMember.mobileNumber = newDetails.mobileNumber;
        existingMember.address = newDetails.address;
        existingMember.amount = newDetails.amount;
        existingMember.joinedDate = newDetails.joinedDate;
        existingMember.duration = newDetails.duration;
        existingMember.expiryDate = newDetails.expiryDate;
        if(newDetails.photo) existingMember.photo = newDetails.photo; // Only update photo if provided

        const updatedMember = await existingMember.save();
        res.json(updatedMember);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// 4. Delete Member
app.delete('/api/members/:id', async (req, res) => {
    try {
        // 1. Find member to log deletion
        const member = await Member.findById(req.params.id);

        // 2. Add to Deleted Log
        if (member) {
            await DeletedLog.create({ name: member.name });
        }

        // 3. Delete from main DB
        await Member.findByIdAndDelete(req.params.id);
        res.json({ message: 'Member deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 5. Get Dashboard Stats
// app.get('/api/stats', async (req, res) => {
//     const { month, year } = req.query; // Expecting month (0-11) and year

//     try {
//         // Calculate Dates
//         const startDate = new Date(year, month, 1);
//         const endDate = new Date(year, parseInt(month) + 1, 0, 23, 59, 59);

//         // 1. New Members this month
//         const newMembers = await Member.countDocuments({
//             createdAt: { $gte: startDate, $lte: endDate }
//         });

//         // 2. Members Left this month
//         const membersLeft = await DeletedLog.countDocuments({
//             dateDeleted: { $gte: startDate, $lte: endDate }
//         });

//         // 3. Revenue this month
//         const revenueAgg = await Member.aggregate([
//             { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
//             { $group: { _id: null, total: { $sum: "$amount" } } }
//         ]);
//         const revenue = revenueAgg[0] ? revenueAgg[0].total : 0;

//         // 4. Total Active Members
//         const totalActive = await Member.countDocuments();

//         res.json({
//             newMembers,
//             membersLeft,
//             revenue,
//             totalActive
//         });

//     } catch (err) {
//         res.status(500).json({ message: err.message });
//     }
// });

// 5. Get Dashboard Stats
app.get('/api/stats', async (req, res) => {
    const { month, year } = req.query;
    const monthNum = parseInt(month);
    const yearNum = parseInt(year);

    try {
        // --- PART 1: MONTHLY REPORT (New, Left, Revenue) ---
        // Calculate Start and End of the selected month
        const startDate = new Date(yearNum, monthNum, 1); // First day of month
        const endDate = new Date(yearNum, parseInt(monthNum) + 1, 0, 23, 59, 59); // Last day of month

        // 1. New Members (Joined in this month)
        const newMembers = await Member.countDocuments({
            createdAt: { $gte: startDate, $lte: endDate }
        });

        // 2. Members Left (Deleted in this month)
        const membersLeft = await DeletedLog.countDocuments({
            dateDeleted: { $gte: startDate, $lte: endDate }
        });

        // 3. Revenue (Sum of amounts paid in this month)
        const revenueResult = await Member.aggregate([
            {
                $match: { createdAt: { $gte: startDate, $lte: endDate } }
            },
            {
                $group: { _id: null, total: { $sum: "$amount" } }
            }
        ]);
        const revenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

        // --- PART 2: CURRENT STATUS (Active, Expired) ---
        // IMPORTANT: We get today as a String "YYYY-MM-DD" to match how we stored expiryDate.
        // This prevents timezone errors where 23:59 looks like tomorrow in UTC.
        const todayStr = new Date().toISOString().split('T')[0];

        // 4. Total Active Members (Expiry date is today or in future)
        const totalActive = await Member.countDocuments({
            expiryDate: { $gte: todayStr }
        });

        // 5. Total Expired Members (Expiry date is in the past)
        const totalExpired = await Member.countDocuments({
            expiryDate: { $lt: todayStr }
        });

        // Send back all 5 metrics
        res.json({
            newMembers,
            membersLeft,
            revenue,
            totalActive,
            totalExpired
        });

    } catch (err) {
        console.error("Dashboard Stats Error:", err);
        res.status(500).json({ message: "Error calculating stats" });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});