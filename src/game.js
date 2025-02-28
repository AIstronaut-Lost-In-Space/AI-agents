import { ChatGroq } from "@langchain/groq";
import { config } from "dotenv";
import { MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { prevProblemSummary } from "./server.js";

config();

class AgentRegistry {
  constructor() {
    this.agents = new Map();
  }

  addAgent(username, personality, stats) {
    this.agents.set(username, {
      systemPrompt: `You are ${username}, ${personality}. You must provide solutions that are in 1-2 lines only.`,
      stats: stats,
      llm: new ChatGroq({
        apiKey: process.env.GROQ_API_KEY,
        modelName: "llama-3.3-70b-versatile"
      })
    });
  }

  getAgent(username) {
    return this.agents.get(username);
  }

  getAllAgents() {
    return Array.from(this.agents.entries());
  }
}

// Initialize the registry
const agentRegistry = new AgentRegistry();

// Master LLM for problem generation and evaluation
const masterLLM = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY,
  modelName: "llama-3.3-70b-versatile"
});

// Problem generation node
async function generateProblem(state) {
  const last_problems = state.messages.find(msg => msg.additional_kwargs?.is_last_problem)?.content;
  const attributes = ["strength", "intelligence", "survivalInstincts"];
  const selectedAttribute = attributes[Math.floor(Math.random() * attributes.length)];

  const systemPrompt = new SystemMessage(
    `You are a master AI on an asteroid where some astronauts have crashed now you are tasked with creating various challenging but solvable problems for them to survive on the asteroid.
     Create a problem that specifically tests the astronauts' ${selectedAttribute}.
     The problem should be of 4-5 lines only and not more than that.
     Format your response as a clear problem statement without any additional commentary.
     Be sure not to repeat the previous problems here's the problems that are provided previously ${last_problems}
     Focus on scenarios that would require ${selectedAttribute} to solve.`
  );

  const generatePrompt = new HumanMessage(
    "Generate a new problem for the agents to solve."
  );

  const problem = await masterLLM.invoke([systemPrompt, generatePrompt]);

  return {
    messages: [
      new AIMessage({
        content: problem.content,
        additional_kwargs: { 
          is_problem: true,
          focused_attribute: selectedAttribute 
        }
      })
    ]
  };
}

// Dynamic agent solution generation
async function agentSolve(state, username) {
  const agent = agentRegistry.getAgent(username);
  if (!agent) {
    throw new Error(`Agent ${username} not found`);
  }

  const problem = state.messages.find(msg => msg.additional_kwargs?.is_problem)?.content;
  const focusedAttribute = state.messages.find(msg => msg.additional_kwargs?.is_problem)?.additional_kwargs.focused_attribute;
  
  const systemMsg = new SystemMessage(
    `${agent.systemPrompt}
     Your stats are ${JSON.stringify(agent.stats)} in json format
     This problem specifically requires ${focusedAttribute}.
     Your ${focusedAttribute} stat is ${agent.stats[focusedAttribute]}.
     Provide a concise solution to the given problem.
     Explain your approach in 1-2 lines only.
     Focus on using your ${focusedAttribute} to solve this problem.`
  );
  
  const solutionMsg = await agent.llm.invoke([
    systemMsg,
    new HumanMessage(problem)
  ]);

  return {
    messages: [
      new AIMessage({
        content: solutionMsg.content,
        additional_kwargs: {
          agent_id: username,
          is_solution: true,
          agent_attribute_score: agent.stats[focusedAttribute]
        }
      })
    ]
  };
}

// Master evaluation node
async function masterEvaluation(state) {
  const problem = state.messages.find(msg => msg.additional_kwargs?.is_problem)?.content;
  const focusedAttribute = state.messages.find(msg => msg.additional_kwargs?.is_problem)?.additional_kwargs.focused_attribute;
  const solutions = state.messages.filter(msg => msg.additional_kwargs?.is_solution);

  const evaluationPrompt = new SystemMessage(
    `You are the master evaluator. Analyze the solutions provided by different agents for the given problem.
     This problem specifically tests ${focusedAttribute}.
     Consider the following criteria:
     1. How well the solution utilizes the agent's ${focusedAttribute}
     2. The agent's ${focusedAttribute} score
     3. Effectiveness of the solution
     4. Practicality of implementation
     
     Provide your evaluation as follows:
     1. Announce the winning agent ID
     2. Only explain in 1-2 lines why it was a better solution`
  );

  const solutionsText = solutions.map(solution => 
    `Agent ${solution.additional_kwargs.agent_id} (${focusedAttribute} score: ${solution.additional_kwargs.agent_attribute_score}) Solution:\n${solution.content}\n`
  ).join('\n\n');

  const evaluation = await masterLLM.invoke([
    evaluationPrompt,
    new HumanMessage(
      `Problem:\n${problem}\n\nSolutions:\n${solutionsText}\n\nPlease evaluate and select the best solution and return the agent id of the winning agent and the evaluation reason in 1-2 lines only and provide the response like this The winning agent is : agentId \n evaluation reason is : evaluationReason`
    )
  ]);

  const agentId = evaluation.content.split("\n")[0].split(":")[1]
  const evaluationReason = evaluation.content.split("\n")[1].split(":")[1]
  return {
    messages: [
      new AIMessage({
        content: evaluation.content,
        additional_kwargs: {
          agentId: agentId,
          evaluationReason: evaluationReason,
          is_evaluation: true,
          focused_attribute: focusedAttribute
        }
      })
    ]
  };
}

// Dynamic graph builder
function buildGameGraph() {
  const graph = new StateGraph(MessagesAnnotation);
  
  // Add problem generation node
  graph.addNode("generate-problem", generateProblem);
  
  // Add nodes for each registered agent
  for (const [username] of agentRegistry.getAllAgents()) {
    graph.addNode(username, state => agentSolve(state, username));
  }
  
  // Add evaluation node
  graph.addNode("evaluation", masterEvaluation);
  
  // Define the flow
  graph.addEdge("__start__", "generate-problem");
  
  // Connect each agent to problem and evaluation
  for (const [username] of agentRegistry.getAllAgents()) {
    graph.addEdge("generate-problem", username);
    graph.addEdge(username, "evaluation");
  }
  
  graph.addEdge("evaluation", "__end__");
  
  return graph.compile();
}

// Game execution function
export async function runGame() {
  const prevProblems = await prevProblemSummary();
  const gameGraph = buildGameGraph();
  
  const result = await gameGraph.invoke({ 
    messages: [
      new HumanMessage({
        content: `The last problem were these ${prevProblems} provide some other challenge`,
        additional_kwargs: {
          is_last_problem: true
        }
      })
    ]
  });
  return result;
}

// Function to add new agent
export function addNewAgent(username, personality, stats) {
  agentRegistry.addAgent(username, personality, stats);
}
