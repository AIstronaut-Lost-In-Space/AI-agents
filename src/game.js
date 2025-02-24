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
    stats: {"strength": 10, "intelligence": 40}
  },
  {
    id: "agent-2",
    systemPrompt: "You are a 23 years old astronaut from nigeria who has lived his entire life between Africa's jungle. You think outside the box and often find unique approaches that others might miss that are in 1-2 lines only.",
    stats: {"strength": 5, "intelligence": 10}
  },
  {
    id: "agent-3",
    systemPrompt: "You are a 32 years old female astronaut who is proud on her beauty even after being in her 30s. You focus on finding the most straightforward and implementable solutions that are in 1-2 lines only.",
    stats: {"strength": 1, "intelligence": 20}
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
  const systemPrompt = new SystemMessage(
    `You are a master AI on an asteroid where some astronauts have crashed now you are tasked with creating various challenging but solvable problems for them to survive on the asteroid.Consider the situation that the asteroid has water, oxygen, co2 etc. 
     Create interesting scenarios that can be solved in multiple ways.
     The problem should be of 4-5 lines only and not more than that.
     Format your response as a clear problem statement without any additional commentary.
     Be sure not to repeat the previous problems here's the problems that are provided previously ${last_problems}
     for example- there can be power outage, toxic gas in lava tube, water contanimation, food shortage etc. don't only focus on lava tube rupture or co2 filling be creative with  `
  );

  const generatePrompt = new HumanMessage(
    "Generate a new problem for the agents to solve."
  );

  const problem = await masterLLM.invoke([systemPrompt, generatePrompt]);

  return {
    messages: [
      new AIMessage({
        content: problem.content,
        additional_kwargs: { is_problem: true }
      })
    ]
  };
}

// Agent solution generation
async function agentSolve(state, agentId) {
  const agentConfig = agentConfigs.find(config => config.id === agentId);
  const agentLLM = agentLLMs.find(a => a.id === agentId).llm;

  // Get the problem from state
  const problem = state.messages.find(msg => msg.additional_kwargs?.is_problem)?.content;
  const stats = agentLLMs.find(a => a.id === agentId).stats;
  const systemMsg = new SystemMessage(
    `${agentConfig.systemPrompt}
     Your stats are ${JSON.stringify(stats)} in json format
     Provide a concise solution to the given problem.
     Explain your approach in 1-2 lines only.
     Focus on your stats also as if you have more stats in strength you are more likely to return a solution which includes strength and same for other stats.
     Focus on demonstrating your unique problem-solving style.
     You are an astronaut so you can use your stats to solve the problem.
    `
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
          is_solution: true
        }
      })
    ]
  };
}

// Master evaluation node
async function masterEvaluation(state) {
  // Get the problem and all solutions
  const problem = state.messages.find(msg => msg.additional_kwargs?.is_problem)?.content;
  const solutions = state.messages.filter(msg => msg.additional_kwargs?.is_solution);

  const evaluationPrompt = new SystemMessage(
    `You are the master evaluator. Analyze the solutions provided by different agents for the given problem.
     Consider the following criteria:
     1. Effectiveness: How well does the solution solve the problem?
     2. Creativity: How innovative is the approach?
     3. Practicality: How feasible is the implementation?
     4. Clarity: How well-explained is the solution?
     5. The stats of the astronauts should be considered as well.
     
     Provide your evaluation as follows:
     1. Announce the winning agent ID
     2. Only explain in 1-2 lines why it was a better solution`
  );

  const solutionsText = solutions.map(solution => 
    `Agent ${solution.additional_kwargs.agent_id} Solution:\n${solution.content}\n`
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
          is_evaluation: true
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
      content:`The last problem were these ${prevProblems} provide some other challenge `,
      additional_kwargs:{
        is_last_problem:true
      }
    })
    
  ]});
  return result;
}





