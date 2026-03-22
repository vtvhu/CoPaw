import { request } from "../request";
import { getApiUrl, getApiToken } from "../config";

export interface DefaultSkillSpec {
  name: string;
  description: string;
  source: "builtin" | "inactive";
  is_active: boolean;
  is_enabled_in_agent: boolean;
  exists_in_agent: boolean;
}

export interface DefaultSkillsListResponse {
  skills: DefaultSkillSpec[];
  current_agent_id: string;
}

export interface UploadResult {
  imported: string[];
  count: number;
}

export interface HubInstallTask {
  task_id: string;
  bundle_url: string;
  version: string;
  enable: boolean;
  overwrite: boolean;
  status: "pending" | "importing" | "completed" | "failed" | "cancelled";
  error: string | null;
  result: {
    imported: string[];
    count: number;
    name: string | null;
  } | null;
  created_at: number;
  updated_at: number;
}

export interface HubInstallStatus {
  task_id: string;
  status: "pending" | "importing" | "completed" | "failed" | "cancelled";
  error: string | null;
  result: {
    imported: string[];
    count: number;
    name: string | null;
  } | null;
}

export const defaultSkillsApi = {
  /** List all default skills */
  listDefaultSkills: () =>
    request<DefaultSkillsListResponse>("/default-skills"),

  /** Enable a skill in current agent */
  enableSkillInAgent: (skillName: string) =>
    request<{ success: boolean; message: string }>("/default-skills/enable", {
      method: "POST",
      body: JSON.stringify({ skill_name: skillName }),
    }),

  /** Disable a skill in current agent */
  disableSkillInAgent: (skillName: string) =>
    request<{ success: boolean; message: string }>("/default-skills/disable", {
      method: "POST",
      body: JSON.stringify({ skill_name: skillName }),
    }),

  /** Set skill builtin status (move between skills and InactiveSkill) */
  setBuiltinStatus: (skillName: string, isBuiltin: boolean) =>
    request<{ success: boolean; message: string }>(
      "/default-skills/set-builtin",
      {
        method: "POST",
        body: JSON.stringify({
          skill_name: skillName,
          is_builtin: isBuiltin,
        }),
      },
    ),

  /** Create a new default skill */
  createDefaultSkill: (payload: {
    name: string;
    content: string;
    references?: Record<string, string>;
    scripts?: Record<string, string>;
  }) =>
    request<{ success: boolean; message: string }>("/default-skills/create", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /** Delete a skill from InactiveSkill */
  deleteInactiveSkill: (skillName: string) =>
    request<{ success: boolean; message: string }>(
      `/default-skills/delete/${encodeURIComponent(skillName)}`,
      {
        method: "DELETE",
      },
    ),

  /** Upload skill zip to builtin skills */
  uploadDefaultSkill: async (
    file: File,
    options?: { overwrite?: boolean },
  ): Promise<UploadResult> => {
    const formData = new FormData();
    formData.append("file", file);

    const params = new URLSearchParams();
    if (options?.overwrite !== undefined) {
      params.set("overwrite", String(options.overwrite));
    }
    const qs = params.toString();
    const url = getApiUrl(`/default-skills/upload${qs ? `?${qs}` : ""}`);

    const headers: Record<string, string> = {};
    const token = getApiToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Upload failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    return await response.json();
  },

  /** Start hub skill install */
  startHubSkillInstall: (payload: {
    bundle_url: string;
    enable?: boolean;
    overwrite?: boolean;
  }) =>
    request<HubInstallTask>("/default-skills/hub/install/start", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /** Get hub skill install status */
  getHubSkillInstallStatus: (taskId: string) =>
    request<HubInstallStatus>(`/default-skills/hub/install/status/${taskId}`),

  /** Cancel hub skill install */
  cancelHubSkillInstall: (taskId: string) =>
    request<{ cancelled: boolean }>(
      `/default-skills/hub/install/cancel/${taskId}`,
      {
        method: "POST",
      },
    ),
};
