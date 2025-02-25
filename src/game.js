import { ChatGroq } from "@langchain/groq";
import { config } from "dotenv";
import { MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { prevProblemSummary } from "./server.js";

config();

// Initialize the LLM
const llm = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY,
  modelName: "llama-3.3-70b-versatile"
});

// Configure agent personalities/approaches
const agentConfigs = [
  {
    id: "agent-1",
    systemPrompt: "You are a 41 years old astronaut with a lot of strength and more experience than others. You excel at breaking down problems into clear steps and providing detailed solutions with strong reasoning that are in 1-2 lines only.",
    stats: {"strength": 10, "intelligence": 4, "survivalInstincts": 6}
  },
  {
    id: "agent-2", 
    systemPrompt: "You are a 23 years old astronaut from nigeria who has lived his entire life between Africa's jungle. You think outside the box and often find unique approaches that others might miss that are in 1-2 lines only.",
    stats: {"strength": 5, "intelligence": 8, "survivalInstincts": 10}
  },
  {
    id: "agent-3",
    systemPrompt: "You are a 32 years old female astronaut who is proud on her beauty even after being in her 30s. You focus on finding the most straightforward and implementable solutions that are in 1-2 lines only.",
    stats: {"strength": 4, "intelligence": 10, "survivalInstincts": 5}
  }
];

// Create LLMs for each agent
const agentLLMs = agentConfigs.map(config => ({
  id: config.id,
  llm: new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    modelName: "llama-3.3-70b-versatile"
  }),
  systemPrompt: config.systemPrompt,
  stats: config.stats
}));

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

// Agent solution generation
async function agentSolve(state, agentId) {
  const agentConfig = agentConfigs.find(config => config.id === agentId);
  const agentLLM = agentLLMs.find(a => a.id === agentId).llm;

  const problem = state.messages.find(msg => msg.additional_kwargs?.is_problem)?.content;
  const focusedAttribute = state.messages.find(msg => msg.additional_kwargs?.is_problem)?.additional_kwargs.focused_attribute;
  const stats = agentLLMs.find(a => a.id === agentId).stats;
  
  const systemMsg = new SystemMessage(
    `${agentConfig.systemPrompt}
     Your stats are ${JSON.stringify(stats)} in json format
     This problem specifically requires ${focusedAttribute}.
     Your ${focusedAttribute} stat is ${stats[focusedAttribute]}.
     Provide a concise solution to the given problem.
     Explain your approach in 1-2 lines only.
     Focus on using your ${focusedAttribute} to solve this problem.`
  );
  
  const solutionMsg = await agentLLM.invoke([
    systemMsg,
    new HumanMessage(problem)
  ]);

  return {
    messages: [
      new AIMessage({
        content: solutionMsg.content,
        additional_kwargs: {
          agent_id: agentId,
          is_solution: true,
          agent_attribute_score: stats[focusedAttribute]
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

// Build the game graph
const gameBuilder = new StateGraph(MessagesAnnotation)
  // Add all nodes
  .addNode("generate-problem", generateProblem)
  .addNode("agent-1", state => agentSolve(state, "agent-1"))
  .addNode("agent-2", state => agentSolve(state, "agent-2"))
  .addNode("agent-3", state => agentSolve(state, "agent-3"))
  .addNode("evaluation", masterEvaluation)
  
  // Define the flow
  .addEdge("__start__", "generate-problem")
  .addEdge("generate-problem", "agent-1")
  .addEdge("generate-problem", "agent-2")
  .addEdge("generate-problem", "agent-3")
  .addEdge("agent-1", "evaluation")
  .addEdge("agent-2", "evaluation")
  .addEdge("agent-3", "evaluation")
  .addEdge("evaluation", "__end__")
  .compile();

// Game execution function
export async function runGame() {
  const prevProblems = await prevProblemSummary();
  const result = await gameBuilder.invoke({ messages:[ 
    new HumanMessage({
      content:`The last problem were these ${prevProblems} provide some other challenge`,
      additional_kwargs:{
        is_last_problem:true
      }
    })
  ]});
  return result;
}
