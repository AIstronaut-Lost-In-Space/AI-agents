import express from 'express';
import {router} from './routes/gameRoutes.js';
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/asteroid-game';

// Game schema
const gameSchema = new mongoose.Schema({
  problem: {
    type: String,
    required: true
  },
  solutions: [{
    agentId: String,
    solution: String
  }],
  evaluation: {
    agentId: String, 
    evaluationReason: String,
    focusedAttribute: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

//user schema
const userSchema = new mongoose.Schema({


name:{
  type: String,
  required: true  
},
walletAddress:{
  type: String,
  required: true
},
avatarID:{
  type: String,
  required: true
},
agentBio:{
  type: String,
  required: true
},
stats:{
  type: Object,
  //{str, int, surInst} define the object for stats
  str: {
    type: Number,
    required: true
  },
  int: {
    type: Number,
    required: true
  },
  surInst:{
    type: Number,
    required: true
  },
  required: true
},
});

// Create Game model
export const Game = mongoose.model('Game', gameSchema);
export const User = mongoose.model('User', userSchema);

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err))

export const prevProblemSummary = async () => {
    const prevProblems = await Game.find({}).sort({createdAt: -1}).limit(20);
    const problemSummary = prevProblems.map(problem => problem.problem).join("\n");
    return problemSummary;
}

const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Mount game routes
app.use('/api/game', router);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
}); 
