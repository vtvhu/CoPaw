import { Card, Button, Tooltip } from "@agentscope-ai/design";
import { DeleteOutlined, ThunderboltOutlined } from "@ant-design/icons";
import type { DefaultSkillSpec } from "../../../../api/modules/defaultSkills";
import { useTranslation } from "react-i18next";
import styles from "../index.module.less";

interface SkillCardProps {
  skill: DefaultSkillSpec;
  isHover: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onToggleEnabled: (e: React.MouseEvent) => void;
  onToggleBuiltin: (e: React.MouseEvent) => void;
  onDelete?: (e?: React.MouseEvent) => void;
}

export function SkillCard({
  skill,
  isHover,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onToggleEnabled,
  onToggleBuiltin,
  onDelete,
}: SkillCardProps) {
  const { t } = useTranslation();

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete(e);
    }
  };

  return (
    <Card
      hoverable
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`${styles.skillCard} ${
        skill.is_active ? styles.builtinCard : styles.inactiveCard
      } ${skill.is_enabled_in_agent ? styles.enabledCard : ""} ${
        isHover ? styles.hover : styles.normal
      }`}
    >
      <div className={styles.cardBody}>
        <div className={styles.cardHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ThunderboltOutlined
              className={styles.fileIcon}
              style={{
                color: skill.is_active ? "#615ced" : "#999",
              }}
            />
            <h3 className={styles.skillTitle}>{skill.name}</h3>
          </div>
          <div className={styles.statusContainer}>
            <span
              className={`${styles.statusDot} ${
                skill.is_enabled_in_agent ? styles.enabled : styles.disabled
              }`}
            />
            <span
              className={`${styles.statusText} ${
                skill.is_enabled_in_agent ? styles.enabled : styles.disabled
              }`}
            >
              {skill.is_enabled_in_agent
                ? t("defaultSkills.enabledInAgent")
                : t("defaultSkills.disabledInAgent")}
            </span>
          </div>
        </div>

        <div className={styles.descriptionSection}>
          <div className={styles.infoLabel}>
            {t("defaultSkills.description")}
          </div>
          <Tooltip
            title={skill.description || "-"}
            placement="top"
            overlayStyle={{ maxWidth: 360 }}
          >
            <div className={`${styles.infoBlock} ${styles.descriptionContent}`}>
              {skill.description || "-"}
            </div>
          </Tooltip>
        </div>

        <div className={styles.metaStack}>
          <div className={styles.infoSection}>
            <div className={styles.infoLabel}>{t("defaultSkills.source")}</div>
            <div>
              <span
                className={
                  skill.is_active ? styles.builtinTag : styles.inactiveTag
                }
              >
                {skill.is_active
                  ? t("defaultSkills.builtin")
                  : t("defaultSkills.inactive")}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.cardFooter}>
        <Button
          type="link"
          size="small"
          onClick={onToggleEnabled}
          className={styles.actionButton}
        >
          {skill.is_enabled_in_agent
            ? t("common.disable")
            : t("defaultSkills.enableInAgent")}
        </Button>

        <Button
          type="link"
          size="small"
          onClick={onToggleBuiltin}
          className={styles.actionButton}
        >
          {skill.is_active
            ? t("defaultSkills.moveToInactive")
            : t("defaultSkills.moveToBuiltin")}
        </Button>

        {!skill.is_active && onDelete && (
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            className={styles.deleteButton}
            onClick={handleDeleteClick}
            disabled={skill.is_enabled_in_agent}
          />
        )}
      </div>
    </Card>
  );
}
