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
    evaluationReason: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create Game model
export const Game = mongoose.model('Game', gameSchema);

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
