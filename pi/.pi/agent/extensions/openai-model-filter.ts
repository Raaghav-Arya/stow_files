import type { AnyModel } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Replace only the catalog view, retaining OpenAI's built-in authentication,
// ChatGPT subscription support, streaming, and model metadata.
export default function (pi: ExtensionAPI) {
  const provider = builtinProviders().find((provider) => provider.id === "openai");
  if (!provider) throw new Error("Pi's built-in OpenAI provider is unavailable.");
  const keep = (model: AnyModel): boolean => {
    const family = /^gpt-(\d+)(?:[.-]|$)/.exec(model.id);
    return family !== null && Number(family[1]) >= 6;
  };

  pi.registerProvider({
    ...provider,
    getModels: () => provider.getModels().filter(keep),
    getAllModels: () => (provider.getAllModels?.() ?? provider.getModels()).filter(keep),
  });
}
