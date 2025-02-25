import { runGame } from '../game.js';
import express from 'express';
import { Game, prevProblemSummary } from '../server.js';
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

