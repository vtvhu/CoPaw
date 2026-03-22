# -*- coding: utf-8 -*-
"""Default skills management API for builtin skills."""

import asyncio
import logging
import shutil
import time
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/default-skills", tags=["default-skills"])


# Re-use HubInstallRequest from skills.py
class HubInstallRequest(BaseModel):
    """Request to install a skill from hub."""

    bundle_url: str
    enable: bool = False
    overwrite: bool = False


# Re-use HubInstallTask structure (simplified for default skills)
class HubInstallTask(BaseModel):
    """Task info for hub install."""

    task_id: str
    bundle_url: str
    version: str
    enable: bool
    overwrite: bool
    status: str
    error: str | None = None
    result: dict | None = None
    created_at: int
    updated_at: int


class HubInstallStatus(BaseModel):
    """Status of hub install task."""

    task_id: str
    status: str
    error: str | None = None
    result: dict | None = None


def get_builtin_skills_dir() -> Path:
    """Get the path to built-in skills directory."""
    return Path(__file__).parent.parent.parent / "agents" / "skills"


def get_inactive_skills_dir() -> Path:
    """Get the path to inactive skills directory."""
    return (
        Path(__file__).parent.parent.parent
        / "agents"
        / "InactiveSkill"
    )


def get_active_skills_dir(workspace_dir: Path) -> Path:
    """Get the path to active skills directory in workspace."""
    return workspace_dir / "active_skills"


class DefaultSkillSpec(BaseModel):
    """Specification for a default skill."""

    name: str
    description: str = ""
    source: str = "builtin"
    is_active: bool = True  # Whether in skills (True) or InactiveSkill (False)
    is_enabled_in_agent: bool = False  # Whether enabled in current agent
    exists_in_agent: bool = False  # Whether exists in current agent


class DefaultSkillsListResponse(BaseModel):
    """Response for listing default skills."""

    skills: list[DefaultSkillSpec]
    current_agent_id: str


class EnableSkillRequest(BaseModel):
    """Request to enable a skill in current agent."""

    skill_name: str


class SetBuiltinStatusRequest(BaseModel):
    """Request to set builtin status."""

    skill_name: str
    is_builtin: bool


class CreateDefaultSkillRequest(BaseModel):
    """Request to create a new default skill."""

    name: str = Field(..., description="Skill name")
    content: str = Field(..., description="Skill content (SKILL.md)")
    references: dict | None = Field(None, description="Reference files")
    scripts: dict | None = Field(None, description="Script files")


def _read_skill_description(skill_md: Path) -> str:
    """Read description from SKILL.md file."""
    try:
        content = skill_md.read_text(encoding="utf-8")
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                import yaml

                frontmatter = yaml.safe_load(parts[1])
                return frontmatter.get("description", "")
    except Exception as e:
        logger.warning(f"Failed to read SKILL.md: {e}")
    return ""


def _collect_skills_from_dir(
    skills_dir: Path,
    active_skills_dir: Path,
    source: str,
    is_active: bool,
) -> list[DefaultSkillSpec]:
    """Collect skills from a directory."""
    skills: list[DefaultSkillSpec] = []
    if not skills_dir.exists():
        return skills

    for skill_dir in skills_dir.iterdir():
        if not skill_dir.is_dir() or not (skill_dir / "SKILL.md").exists():
            continue

        skill_name = skill_dir.name
        description = _read_skill_description(skill_dir / "SKILL.md")

        agent_skill_dir = active_skills_dir / skill_name
        exists_in_agent = (
            agent_skill_dir.exists()
            and (agent_skill_dir / "SKILL.md").exists()
        )

        skills.append(
            DefaultSkillSpec(
                name=skill_name,
                description=description,
                source=source,
                is_active=is_active,
                is_enabled_in_agent=exists_in_agent,
                exists_in_agent=exists_in_agent,
            ),
        )
    return skills


@router.get("", response_model=DefaultSkillsListResponse)
async def list_default_skills(request: Request):
    """List all default skills (builtin + inactive) with their status."""
    from ..agent_context import get_agent_for_request

    workspace = await get_agent_for_request(request)
    workspace_dir = Path(workspace.workspace_dir)
    agent_id = workspace.agent_id

    builtin_dir = get_builtin_skills_dir()
    inactive_dir = get_inactive_skills_dir()
    active_skills_dir = get_active_skills_dir(workspace_dir)

    # Ensure directories exist
    builtin_dir.mkdir(parents=True, exist_ok=True)
    inactive_dir.mkdir(parents=True, exist_ok=True)

    # Collect all skills from both directories
    all_skills: list[DefaultSkillSpec] = []
    all_skills.extend(
        _collect_skills_from_dir(
            builtin_dir,
            active_skills_dir,
            "builtin",
            True,
        ),
    )
    all_skills.extend(
        _collect_skills_from_dir(
            inactive_dir,
            active_skills_dir,
            "inactive",
            False,
        ),
    )

    logger.info(f"Total skills found: {len(all_skills)}")
    return DefaultSkillsListResponse(
        skills=all_skills,
        current_agent_id=agent_id,
    )


@router.post("/enable")
async def enable_skill_in_agent(
    request: Request,
    body: EnableSkillRequest,
):
    """Enable a skill in the current agent by copying to active_skills."""
    from ..agent_context import get_agent_for_request

    workspace = await get_agent_for_request(request)
    workspace_dir = Path(workspace.workspace_dir)
    active_skills_dir = get_active_skills_dir(workspace_dir)

    skill_name = body.skill_name

    # Find skill source (builtin or inactive)
    builtin_dir = get_builtin_skills_dir()
    inactive_dir = get_inactive_skills_dir()

    source_dir = None
    if (builtin_dir / skill_name).exists():
        source_dir = builtin_dir / skill_name
    elif (inactive_dir / skill_name).exists():
        source_dir = inactive_dir / skill_name
    else:
        raise HTTPException(
            status_code=404,
            detail=f"Skill '{skill_name}' not found",
        )

    # Copy to agent's active_skills
    target_dir = active_skills_dir / skill_name
    if target_dir.exists():
        # Already exists, just return success
        return {"success": True, "message": "Skill already exists in agent"}

    try:
        shutil.copytree(source_dir, target_dir)
        logger.info(
            f"Copied skill '{skill_name}' to agent '{workspace.agent_id}'",
        )
        return {
            "success": True,
            "message": f"Skill '{skill_name}' enabled in agent",
        }
    except Exception as e:
        logger.error(f"Failed to copy skill: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to enable skill: {e}",
        ) from e


@router.post("/disable")
async def disable_skill_in_agent(
    request: Request,
    body: EnableSkillRequest,
):
    """Disable a skill in the current agent by removing from active_skills."""
    from ..agent_context import get_agent_for_request

    workspace = await get_agent_for_request(request)
    workspace_dir = Path(workspace.workspace_dir)
    active_skills_dir = get_active_skills_dir(workspace_dir)

    skill_name = body.skill_name
    target_dir = active_skills_dir / skill_name

    if not target_dir.exists():
        return {"success": True, "message": "Skill not enabled in agent"}

    try:
        shutil.rmtree(target_dir)
        logger.info(
            f"Removed skill '{skill_name}' from agent '{workspace.agent_id}'",
        )
        return {
            "success": True,
            "message": f"Skill '{skill_name}' disabled in agent",
        }
    except Exception as e:
        logger.error(f"Failed to remove skill: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to disable skill: {e}",
        ) from e


@router.post("/set-builtin")
async def set_builtin_status(
    _request: Request,
    body: SetBuiltinStatusRequest,
):
    """Set a skill's builtin status (move between skills and InactiveSkill)."""
    skill_name = body.skill_name
    is_builtin = body.is_builtin

    builtin_dir = get_builtin_skills_dir()
    inactive_dir = get_inactive_skills_dir()

    # Ensure directories exist
    builtin_dir.mkdir(parents=True, exist_ok=True)
    inactive_dir.mkdir(parents=True, exist_ok=True)

    if is_builtin:
        # Move from inactive to builtin
        source = inactive_dir / skill_name
        target = builtin_dir / skill_name
    else:
        # Move from builtin to inactive
        source = builtin_dir / skill_name
        target = inactive_dir / skill_name

    if not source.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Skill '{skill_name}' not found",
        )

    if target.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Skill '{skill_name}' already exists in target directory",
        )

    try:
        shutil.move(str(source), str(target))
        status = "builtin" if is_builtin else "inactive"
        logger.info(f"Moved skill '{skill_name}' to {status}")
        return {
            "success": True,
            "message": f"Skill '{skill_name}' moved to {status}",
        }
    except Exception as e:
        logger.error(f"Failed to move skill: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to move skill: {e}",
        ) from e


@router.post("/create")
async def create_default_skill(
    _request: Request,
    body: CreateDefaultSkillRequest,
):
    """Create a new default skill in builtin skills directory."""
    builtin_dir = get_builtin_skills_dir()
    builtin_dir.mkdir(parents=True, exist_ok=True)

    skill_name = body.name

    # Validate skill name
    if (
        not skill_name
        or not skill_name.replace("_", "").replace("-", "").isalnum()
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid skill name. "
                "Only letters, numbers, underscores, and hyphens allowed."
            ),
        )

    skill_dir = builtin_dir / skill_name
    if skill_dir.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Skill '{skill_name}' already exists",
        )

    try:
        # Create skill directory
        skill_dir.mkdir(parents=True, exist_ok=True)

        # Write SKILL.md
        skill_md = skill_dir / "SKILL.md"
        skill_md.write_text(body.content, encoding="utf-8")

        # Write reference files if provided
        if body.references:
            refs_dir = skill_dir / "references"
            refs_dir.mkdir(parents=True, exist_ok=True)
            for filename, content in body.references.items():
                (refs_dir / filename).write_text(content, encoding="utf-8")

        # Write script files if provided
        if body.scripts:
            scripts_dir = skill_dir / "scripts"
            scripts_dir.mkdir(parents=True, exist_ok=True)
            for filename, content in body.scripts.items():
                (scripts_dir / filename).write_text(content, encoding="utf-8")

        logger.info(f"Created default skill '{skill_name}'")
        return {"success": True, "message": f"Skill '{skill_name}' created"}
    except Exception as e:
        logger.error(f"Failed to create skill: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create skill: {e}",
        ) from e


@router.delete("/delete/{skill_name}")
async def delete_default_skill(
    skill_name: str,
):
    """Delete a skill from inactive skills directory."""
    inactive_dir = get_inactive_skills_dir()
    skill_dir = inactive_dir / skill_name

    if not skill_dir.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Skill '{skill_name}' not found in InactiveSkill",
        )

    try:
        shutil.rmtree(skill_dir)
        logger.info(f"Deleted inactive skill '{skill_name}'")
        return {"success": True, "message": f"Skill '{skill_name}' deleted"}
    except Exception as e:
        logger.error(f"Failed to delete skill: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete skill: {e}",
        ) from e


@router.post("/upload")
async def upload_default_skill_zip(
    file: UploadFile = File(...),
    overwrite: bool = False,
):
    """Import skill(s) from an uploaded zip file to builtin skills."""
    import zipfile
    import io
    import tempfile

    builtin_dir = get_builtin_skills_dir()
    builtin_dir.mkdir(parents=True, exist_ok=True)

    # Validate file type
    allowed_types = [
        "application/zip",
        "application/x-zip-compressed",
        "application/octet-stream",
    ]
    if file.content_type and file.content_type not in allowed_types:
        # Also check by extension
        if not (file.filename and file.filename.lower().endswith(".zip")):
            raise HTTPException(
                status_code=400,
                detail="Expected a zip file",
            )

    data = await file.read()
    max_size = 100 * 1024 * 1024  # 100 MB
    if len(data) > max_size:
        raise HTTPException(
            status_code=400,
            detail=(
                f"File too large ({len(data) // (1024 * 1024)} MB). "
                "Maximum is 100 MB."
            ),
        )

    if not zipfile.is_zipfile(io.BytesIO(data)):
        raise HTTPException(status_code=400, detail="Invalid zip file")

    tmp_dir: Path | None = None
    try:
        tmp_dir = Path(tempfile.mkdtemp(prefix="copaw_default_skill_"))

        # Extract zip
        with zipfile.ZipFile(io.BytesIO(data), "r") as zip_ref:
            zip_ref.extractall(tmp_dir)

        # Find skill directories (directories containing SKILL.md)
        def find_skill_dirs(root: Path) -> list[tuple[Path, str]]:
            """Find all directories containing SKILL.md."""
            result = []
            for item in root.rglob("SKILL.md"):
                skill_dir = item.parent
                if skill_dir != root:
                    result.append((skill_dir, skill_dir.name))
            return result

        found = find_skill_dirs(tmp_dir)
        if not found:
            raise HTTPException(
                status_code=400,
                detail=(
                    "No valid skills found in zip. "
                    "Each skill directory must contain a SKILL.md file."
                ),
            )

        imported = []
        for skill_dir, name in found:
            target = builtin_dir / name
            if target.exists():
                if not overwrite:
                    continue
                shutil.rmtree(target)

            shutil.copytree(skill_dir, target)
            imported.append(name)

        return {
            "imported": imported,
            "count": len(imported),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to upload default skill: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Upload failed: {e}",
        ) from e
    finally:
        if tmp_dir and tmp_dir.exists():
            shutil.rmtree(tmp_dir, ignore_errors=True)


# ─── Hub Import APIs (for importing skills from URL) ────────

# In-memory task storage (same as skills.py)
_hub_install_tasks: dict[str, dict] = {}


@router.post("/hub/install/start", response_model=HubInstallTask)
async def start_install_from_hub(
    _request: Request,
    body: HubInstallRequest,
):
    """Start async task to install a skill from hub to builtin skills."""
    import uuid

    task_id = f"df_{uuid.uuid4().hex[:8]}"
    task = {
        "task_id": task_id,
        "bundle_url": body.bundle_url,
        "version": "",
        "enable": body.enable,
        "overwrite": body.overwrite,
        "status": "pending",
        "error": None,
        "result": None,
        "created_at": int(time.time()),
        "updated_at": int(time.time()),
    }
    _hub_install_tasks[task_id] = task

    # Start background task using common hub install function
    asyncio.create_task(
        _run_hub_install(task_id, body.bundle_url, body.overwrite),
    )

    return HubInstallTask(**task)


@router.get("/hub/install/status/{task_id}", response_model=HubInstallStatus)
async def get_install_status(task_id: str):
    """Get status of hub install task."""
    if task_id not in _hub_install_tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    task = _hub_install_tasks[task_id]
    return HubInstallStatus(
        task_id=task["task_id"],
        status=task["status"],
        error=task.get("error"),
        result=task.get("result"),
    )


@router.post("/hub/install/cancel/{task_id}")
async def cancel_install(task_id: str):
    """Cancel a hub install task."""
    if task_id not in _hub_install_tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    task = _hub_install_tasks[task_id]
    if task["status"] in ("completed", "failed", "cancelled"):
        return {"cancelled": False}

    task["status"] = "cancelled"
    task["updated_at"] = int(time.time())
    return {"cancelled": True}


async def _run_hub_install(task_id: str, bundle_url: str, overwrite: bool):
    """Run hub install in background using common function from skills_hub."""
    from ...agents.skills_hub import install_skill_from_hub

    if task_id not in _hub_install_tasks:
        return

    task = _hub_install_tasks[task_id]
    builtin_dir = get_builtin_skills_dir()
    builtin_dir.mkdir(parents=True, exist_ok=True)

    try:
        task["status"] = "importing"
        task["updated_at"] = int(time.time())

        # Use common hub install function
        result = await asyncio.get_running_loop().run_in_executor(
            None,
            lambda: install_skill_from_hub(
                workspace_dir=builtin_dir,
                bundle_url=bundle_url,
                overwrite=overwrite,
            ),
        )

        task["status"] = "completed"
        task["result"] = {
            "imported": [result.name],
            "count": 1,
            "name": result.name,
        }
        logger.info(f"Imported skill from hub: {result.name}")

    except Exception as e:
        task["status"] = "failed"
        task["error"] = str(e)
        task["result"] = None
        logger.error(f"Failed to import skill from hub: {e}")

    task["updated_at"] = int(time.time())
