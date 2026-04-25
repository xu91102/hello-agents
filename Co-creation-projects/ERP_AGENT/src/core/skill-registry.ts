import { logger } from '../logger';
import type { SkillDef } from './types';

export class SkillRegistry {
  private skills: Map<string, SkillDef> = new Map();

  register(skill: SkillDef): void {
    if (this.skills.has(skill.name)) {
      logger.warn({ skillName: skill.name }, 'Skill 名称重复，将覆盖已存在 Skill');
    }

    this.skills.set(skill.name, skill);
    logger.debug({ skillName: skill.name }, 'Skill 注册成功');
  }

  registerAll(skills: SkillDef[]): void {
    skills.forEach((skill) => this.register(skill));
  }

  get(name: string): SkillDef | undefined {
    return this.skills.get(name);
  }

  getAll(): SkillDef[] {
    return Array.from(this.skills.values());
  }

  findMatch(message: string, context?: Record<string, unknown>): SkillDef | undefined {
    return this.getAll().find((skill) => skill.matches(message, context));
  }

  get size(): number {
    return this.skills.size;
  }
}

export const skillRegistry = new SkillRegistry();
