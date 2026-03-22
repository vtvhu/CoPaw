import { useState, useCallback, useEffect, useRef } from "react";
import { Button, Upload, message, Modal, Form, Input, InputRef } from "antd";
import {
  PlusOutlined,
  UploadOutlined,
  DownloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { DefaultSkillSpec } from "../../../api/modules/defaultSkills";
import { defaultSkillsApi } from "../../../api/modules/defaultSkills";
import { useAgentStore } from "../../../stores/agentStore";
import { SkillCard } from "./components";
import styles from "./index.module.less";

const { TextArea } = Input;

export default function DefaultSkillsPage() {
  const { t } = useTranslation();
  const { selectedAgent } = useAgentStore();
  const [skills, setSkills] = useState<DefaultSkillSpec[]>([]);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importUrlError, setImportUrlError] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const importTaskIdRef = useRef<string | null>(null);
  const importCancelReasonRef = useRef<"manual" | "timeout" | null>(null);
  const searchInputRef = useRef<InputRef>(null);

  const fetchSkills = useCallback(async () => {
    try {
      const data = await defaultSkillsApi.listDefaultSkills();
      setSkills(data.skills);
    } catch (error: any) {
      console.error("Failed to load default skills:", error);
      message.error(t("defaultSkills.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    fetchSkills();
  }, [selectedAgent, fetchSkills]);

  const handleToggleEnable = async (skill: DefaultSkillSpec) => {
    try {
      if (skill.is_enabled_in_agent) {
        await defaultSkillsApi.disableSkillInAgent(skill.name);
        message.success(t("defaultSkills.disableSuccess"));
      } else {
        await defaultSkillsApi.enableSkillInAgent(skill.name);
        message.success(t("defaultSkills.enableSuccess"));
      }
      await fetchSkills();
    } catch (error: any) {
      console.error("Failed to toggle skill:", error);
      message.error(
        skill.is_enabled_in_agent
          ? t("defaultSkills.disableFailed")
          : t("defaultSkills.enableFailed"),
      );
    }
  };

  const handleToggleBuiltin = async (skill: DefaultSkillSpec) => {
    try {
      await defaultSkillsApi.setBuiltinStatus(skill.name, !skill.is_active);
      message.success(
        skill.is_active
          ? t("defaultSkills.moveToInactive")
          : t("defaultSkills.moveToBuiltin"),
      );
      await fetchSkills();
    } catch (error: any) {
      console.error("Failed to toggle builtin status:", error);
      message.error(t("defaultSkills.toggleBuiltinFailed"));
    }
  };

  const handleDelete = async (skill: DefaultSkillSpec) => {
    if (skill.is_active) {
      message.warning(t("defaultSkills.mustMoveToInactiveFirst"));
      return;
    }
    if (skill.is_enabled_in_agent) {
      message.warning(t("defaultSkills.mustDisableFirst"));
      return;
    }

    Modal.confirm({
      title: t("defaultSkills.deleteConfirm"),
      content: t("defaultSkills.deleteConfirmDesc", { name: skill.name }),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      okType: "danger",
      onOk: async () => {
        try {
          await defaultSkillsApi.deleteInactiveSkill(skill.name);
          message.success(t("defaultSkills.deleteSuccess"));
          await fetchSkills();
        } catch (error: any) {
          console.error("Failed to delete skill:", error);
          message.error(t("defaultSkills.deleteFailed"));
        }
      },
    });
  };

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const result = await defaultSkillsApi.uploadDefaultSkill(file, {
          overwrite: false,
        });
        message.success(
          t("defaultSkills.uploadSuccess", { count: result.count }) as string,
        );
        await fetchSkills();
      } catch (error: any) {
        console.error("Upload failed:", error);
        message.error(error.message || t("defaultSkills.uploadFailed"));
      } finally {
        setUploading(false);
      }
      return false;
    },
    [fetchSkills, t],
  );

  const supportedSkillUrlPrefixes = [
    "https://skills.sh/",
    "https://clawhub.ai/",
    "https://skillsmp.com/",
    "https://lobehub.com/",
    "https://market.lobehub.com/",
    "https://github.com/",
    "https://modelscope.cn/skills/",
  ];

  const isSupportedSkillUrl = (url: string) => {
    return supportedSkillUrlPrefixes.some((prefix) => url.startsWith(prefix));
  };

  const closeImportModal = () => {
    if (importing) {
      return;
    }
    setImportModalOpen(false);
    setImportUrl("");
    setImportUrlError("");
  };

  const handleImportFromHub = () => {
    setImportModalOpen(true);
  };

  const handleImportUrlChange = (value: string) => {
    setImportUrl(value);
    const trimmed = value.trim();
    if (trimmed && !isSupportedSkillUrl(trimmed)) {
      setImportUrlError(t("skills.invalidSkillUrlSource"));
      return;
    }
    setImportUrlError("");
  };

  const handleConfirmImport = async () => {
    if (importing) return;
    const trimmed = importUrl.trim();
    if (!trimmed) return;
    if (!isSupportedSkillUrl(trimmed)) {
      setImportUrlError(t("skills.invalidSkillUrlSource"));
      return;
    }

    const timeoutMs = 90_000;
    const pollMs = 1_000;
    const startedAt = Date.now();

    try {
      setImporting(true);
      importCancelReasonRef.current = null;

      const task = await defaultSkillsApi.startHubSkillInstall({
        bundle_url: trimmed,
        overwrite: false,
      });
      importTaskIdRef.current = task.task_id;

      while (importTaskIdRef.current) {
        const status = await defaultSkillsApi.getHubSkillInstallStatus(
          task.task_id,
        );

        if (status.status === "completed" && status.result?.imported) {
          message.success(
            t("defaultSkills.importSuccess", {
              count: status.result.imported.length,
            }) as string,
          );
          await fetchSkills();
          closeImportModal();
          return;
        }

        if (status.status === "failed") {
          throw new Error(status.error || "Import failed");
        }

        if (status.status === "cancelled") {
          message.warning(
            t(
              importCancelReasonRef.current === "timeout"
                ? "skills.importTimeout"
                : "skills.importCancelled",
            ),
          );
          closeImportModal();
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          importCancelReasonRef.current = "timeout";
          await defaultSkillsApi.cancelHubSkillInstall(task.task_id);
        }

        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    } catch (error: any) {
      console.error("Import failed:", error);
      message.error(error.message || t("defaultSkills.importFailed"));
    } finally {
      setImporting(false);
      importTaskIdRef.current = null;
      importCancelReasonRef.current = null;
    }
  };

  const cancelImport = useCallback(() => {
    if (!importing) return;
    importCancelReasonRef.current = "manual";
    const taskId = importTaskIdRef.current;
    if (!taskId) return;
    void defaultSkillsApi.cancelHubSkillInstall(taskId);
  }, [importing]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreating(true);

      const content = values.content;
      const payload = {
        name: values.name,
        content: content,
      };

      await defaultSkillsApi.createDefaultSkill(payload);
      message.success(t("defaultSkills.createSuccess"));
      setCreateModalOpen(false);
      form.resetFields();
      await fetchSkills();
    } catch (error: any) {
      console.error("Failed to create skill:", error);
    } finally {
      setCreating(false);
    }
  };

  const uploadProps = {
    accept: ".zip",
    showUploadList: false,
    beforeUpload: handleUpload,
    disabled: uploading,
  };

  const handleMouseEnter = (skillName: string) => {
    setHoverKey(skillName);
  };

  const handleMouseLeave = () => {
    setHoverKey(null);
  };

  return (
    <div className={styles.defaultSkillsPage}>
      <div className={styles.header}>
        <div className={styles.headerInfo}>
          <h1 className={styles.title}>{t("defaultSkills.management")}</h1>
          <p className={styles.description}>
            {t("defaultSkills.pageDescription")}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Input
            ref={searchInputRef}
            placeholder={t("defaultSkills.searchPlaceholder")}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 200 }}
          />
          <Upload {...uploadProps}>
            <Button
              type="primary"
              icon={<UploadOutlined />}
              loading={uploading}
              disabled={uploading}
            >
              {t("defaultSkills.upload")}
            </Button>
          </Upload>
          <Button
            type="primary"
            onClick={handleImportFromHub}
            icon={<DownloadOutlined />}
          >
            {t("defaultSkills.importSkills")}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalOpen(true)}
          >
            {t("defaultSkills.create")}
          </Button>
        </div>
      </div>

      <div className={styles.skillsGrid}>
        {skills
          .filter(
            (skill) =>
              skill.name.toLowerCase().includes(searchValue.toLowerCase()) ||
              skill.description
                .toLowerCase()
                .includes(searchValue.toLowerCase()),
          )
          .map((skill) => (
            <SkillCard
              key={skill.name}
              skill={skill}
              isHover={hoverKey === skill.name}
              onClick={() => {}}
              onMouseEnter={() => handleMouseEnter(skill.name)}
              onMouseLeave={handleMouseLeave}
              onToggleEnabled={(e) => {
                e?.stopPropagation();
                handleToggleEnable(skill);
              }}
              onToggleBuiltin={(e) => {
                e?.stopPropagation();
                handleToggleBuiltin(skill);
              }}
              onDelete={(e) => {
                e?.stopPropagation();
                handleDelete(skill);
              }}
            />
          ))}
      </div>

      <Modal
        title={t("defaultSkills.importSkills")}
        open={importModalOpen}
        onCancel={closeImportModal}
        maskClosable={!importing}
        closable={!importing}
        keyboard={!importing}
        footer={
          <div style={{ textAlign: "right" }}>
            <Button
              onClick={importing ? cancelImport : closeImportModal}
              style={{ marginRight: 8 }}
            >
              {t(importing ? "defaultSkills.cancelImport" : "common.cancel")}
            </Button>
            <Button
              type="primary"
              onClick={handleConfirmImport}
              loading={importing}
              disabled={importing || !importUrl.trim() || !!importUrlError}
            >
              {t("defaultSkills.importSkills")}
            </Button>
          </div>
        }
        width={760}
      >
        <div className={styles.importHintBlock}>
          <p className={styles.importHintTitle}>
            {t("defaultSkills.supportedSkillUrlSources")}
          </p>
          <ul className={styles.importHintList}>
            <li>https://skills.sh/</li>
            <li>https://clawhub.ai/</li>
            <li>https://skillsmp.com/</li>
            <li>https://lobehub.com/</li>
            <li>https://market.lobehub.com/</li>
            <li>https://github.com/</li>
            <li>https://modelscope.cn/skills/</li>
          </ul>
          <p className={styles.importHintTitle}>
            {t("defaultSkills.urlExamples")}
          </p>
          <ul className={styles.importHintList}>
            <li>https://skills.sh/vercel-labs/find-skills</li>
            <li>https://lobehub.com/zh/skills/openclaw-skills-cli-developer</li>
            <li>
              https://market.lobehub.com/api/v1/skills/openclaw-skills-cli-developer/download
            </li>
            <li>
              https://github.com/anthropics/skills/tree/main/skills/skill-creator
            </li>
            <li>https://modelscope.cn/skills/@anthropics/skill-creator</li>
          </ul>
        </div>

        <input
          className={styles.importUrlInput}
          value={importUrl}
          onChange={(e) => handleImportUrlChange(e.target.value)}
          placeholder={t("defaultSkills.enterSkillUrl")}
          disabled={importing}
        />
        {importUrlError ? (
          <div className={styles.importUrlError}>{importUrlError}</div>
        ) : null}
        {importing ? (
          <div className={styles.importLoadingText}>{t("common.loading")}</div>
        ) : null}
      </Modal>

      <Modal
        open={createModalOpen}
        title={t("defaultSkills.createSkill")}
        onCancel={() => {
          setCreateModalOpen(false);
          form.resetFields();
        }}
        footer={
          <div>
            <Button
              onClick={() => {
                setCreateModalOpen(false);
                form.resetFields();
              }}
              style={{ marginRight: 8 }}
            >
              {t("common.cancel")}
            </Button>
            <Button type="primary" onClick={handleCreate} loading={creating}>
              {t("common.create")}
            </Button>
          </div>
        }
        width={800}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t("defaultSkills.skillName")}
            rules={[
              {
                required: true,
                message: t("defaultSkills.nameRequired"),
              },
              {
                pattern: /^[a-zA-Z_][a-zA-Z0-9_]*$/,
                message: t("defaultSkills.nameFormat"),
              },
            ]}
          >
            <Input placeholder={t("defaultSkills.namePlaceholder")} />
          </Form.Item>

          <Form.Item
            name="content"
            label={t("defaultSkills.skillContent")}
            rules={[
              {
                required: true,
                message: t("defaultSkills.contentRequired"),
              },
            ]}
          >
            <TextArea
              rows={15}
              placeholder={t("defaultSkills.contentPlaceholder")}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
