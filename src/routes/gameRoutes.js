import { runGame, addNewAgent } from '../game.js';
import express from 'express';
import { Game, User, prevProblemSummary } from '../server.js';
export const router = express.Router();

router.get('/play', async (req, res) => {
    console.log("new game request received")
    try {
        // Execute game with previous problems
        const gameResult = await runGame();
        
        // Format the response
        const response = {
            problem: gameResult.messages.find(msg => msg.additional_kwargs?.is_problem)?.content,
            solutions: gameResult.messages
                .filter(msg => msg.additional_kwargs?.is_solution)
                .map(solution => ({
                    agentId: solution.additional_kwargs.agent_id,
                    solution: solution.content
                })),
                
            evaluation: {
                agentId:gameResult.messages.find(msg => msg.additional_kwargs?.is_evaluation)?.additional_kwargs.agentId,
                evaluationReason:gameResult.messages.find(msg => msg.additional_kwargs?.is_evaluation)?.additional_kwargs.evaluationReason,
                focusedAttribute:gameResult.messages.find(msg => msg.additional_kwargs?.is_evaluation)?.additional_kwargs.focused_attribute
            }
            };
        // Save game to MongoDB
        const game = new Game(response);
        await game.save(); 
        console.log("Game saved to MongoDB");
        
        res.json({
            success: true,
            gameState: response
        });
    } catch (error) {
        console.error('Game error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/problems', async (req, res) => {
    const prevProblems = await Game.find({}).sort({createdAt: -1}).limit(20);
    res.json({
        prevProblems
    });
});

// Create a new player agent
router.post('/agents', async (req, res) => {
    try {
        const { name, walletAddress, avatarID, agentBio, stats } = req.body;

        // Validate required fields
        if (!name || !walletAddress || !avatarID || !agentBio || !stats) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        // Validate stats
        if (!stats.strength || !stats.intelligence || !stats.survivalInstincts) {
            return res.status(400).json({
                success: false,
                error: 'Invalid stats object'
            });
        }

        // Create user in database
        const user = new User({
            name,
            walletAddress,
            avatarID,
            agentBio,
            stats
        });
        await user.save();

        // Add agent to the game registry
        addNewAgent(name, agentBio, {
            strength: stats.str,
            intelligence: stats.int,
            survivalInstincts: stats.surInst
        });

        res.json({
            success: true,
            message: 'Agent created successfully',
            agent: user
        });
    } catch (error) {
        console.error('Agent creation error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get all agents
router.get('/agents', async (req, res) => {
    try {
        const agents = await User.find({});
        res.json({
            success: true,
            agents
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get agent solutions history
router.get('/agents/:walletAddress/solutions', async (req, res) => {
    try {
        const { walletAddress } = req.params;
        
        // Find the user
        const user = await User.findOne({ walletAddress });
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Agent not found'
            });
        }

        // Find all games where this agent participated
        const games = await Game.find({
            'solutions.agentId': user.name
        }).sort({ createdAt: -1 });

        // Format the response
        const solutionHistory = games.map(game => ({
            problem: game.problem,
            agentSolution: game.solutions.find(s => s.agentId === user.name),
            winner: game.evaluation.agentId === user.name,
            evaluationReason: game.evaluation.evaluationReason,
            focusedAttribute: game.evaluation.focusedAttribute,
            createdAt: game.createdAt
        }));

        res.json({
            success: true,
            solutionHistory
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get specific game details
router.get('/games/:gameId', async (req, res) => {
    try {
        const game = await Game.findById(req.params.gameId);
        if (!game) {
            return res.status(404).json({
                success: false,
                error: 'Game not found'
            });
        }

        res.json({
            success: true,
            game
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

