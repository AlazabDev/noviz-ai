import { LLMProvider } from "../../core/types";
import { appConfig } from "../../config/app.config";
import { OpenAIProvider } from "./openaiProvider";
import { AzureFoundryProvider } from "./azureFoundryProvider";

/**
 * The one place that reads LLM_PROVIDER and picks a concrete
 * LLMProvider. agent.routes.ts calls this once at module load instead
 * of hardcoding `new OpenAIProvider()` — everything downstream
 * (reasoningEngine.ts) only ever sees the LLMProvider interface, so
 * adding a third provider later is exactly this file + one new class,
 * same as azureFoundryProvider.ts was added.
 */
export function createLLMProvider(): LLMProvider {
  switch (appConfig.llm.provider) {
    case "azure_foundry":
      return new AzureFoundryProvider();
    case "openai":
    default:
      return new OpenAIProvider();
  }
}
