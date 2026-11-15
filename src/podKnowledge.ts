/**
 * Sincronização viva do RAG com os arquivos reais de configuração do servidor
 * dentro do pod Kubernetes (`zp_zombieclasses.ini`, `zp_extraitems.ini`,
 * `mapcycle.txt`, etc.). Se o pod ou `kubectl` não estiverem acessíveis,
 * degrada graciosamente para 0 chunks sem afetar o boot.
 */

import { config } from "./config";
import { storeKnowledgeText } from "./knowledgeStore";
import { fetchPodFiles } from "./podFiles";

interface PodKnowledgeSource {
  source: string;
  candidates: string[];
  label: string;
}

const POD_SOURCES: PodKnowledgeSource[] = [
  {
    source: "pod:zp_zombieclasses.ini",
    candidates: [
      "cstrike/addons/amxmodx/configs/zp_zombieclasses.ini",
      "addons/amxmodx/configs/zp_zombieclasses.ini",
    ],
    label: "Classes de Zumbi configuradas no servidor (zp_zombieclasses.ini)",
  },
  {
    source: "pod:zp_humanclasses.ini",
    candidates: [
      "cstrike/addons/amxmodx/configs/zp_humanclasses.ini",
      "addons/amxmodx/configs/zp_humanclasses.ini",
    ],
    label: "Classes Humanas configuradas no servidor (zp_humanclasses.ini)",
  },
  {
    source: "pod:zp_extraitems.ini",
    candidates: [
      "cstrike/addons/amxmodx/configs/zp_extraitems.ini",
      "addons/amxmodx/configs/zp_extraitems.ini",
    ],
    label: "Itens Extras configurados no servidor (zp_extraitems.ini)",
  },
  {
    source: "pod:mapcycle.txt",
    candidates: ["cstrike/mapcycle.txt", "mapcycle.txt"],
    label: "Lista oficial de mapas da rotação (mapcycle.txt)",
  },
];

export interface PodSyncDeps {
  enabled: boolean;
  fetchFiles: typeof fetchPodFiles;
  storeText: typeof storeKnowledgeText;
}

const defaultDeps: PodSyncDeps = {
  get enabled() {
    return config.podKnowledgeEnabled;
  },
  fetchFiles: fetchPodFiles,
  storeText: storeKnowledgeText,
};

export async function syncPodKnowledge(
  deps: PodSyncDeps = defaultDeps,
): Promise<{ filesRead: number; chunksIndexed: number }> {
  if (!deps.enabled) return { filesRead: 0, chunksIndexed: 0 };
  try {
    const buffers = await deps.fetchFiles(POD_SOURCES.map((s) => s.candidates));
    let filesRead = 0;
    let chunksIndexed = 0;
    for (let i = 0; i < POD_SOURCES.length; i++) {
      const meta = POD_SOURCES[i];
      const buf = buffers[i];
      if (!meta || !buf || buf.length === 0) continue;
      const raw = buf.toString("utf8").trim();
      if (!raw) continue;
      filesRead++;
      const doc = `# ${meta.label}\n\n${raw.slice(0, 24_000)}`;
      chunksIndexed += await deps.storeText(meta.source, doc);
    }
    return { filesRead, chunksIndexed };
  } catch (error) {
    console.warn("[podKnowledge] sync falhou", error);
    return { filesRead: 0, chunksIndexed: 0 };
  }
}
