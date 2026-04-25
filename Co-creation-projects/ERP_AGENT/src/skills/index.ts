import { skillRegistry } from '../core/skill-registry';
import { logger } from '../logger';
import { customerServiceSkill } from './customer-service-skill';
import { fulfillmentSkill } from './fulfillment-skill';

export function initializeSkills(): void {
  skillRegistry.registerAll([fulfillmentSkill, customerServiceSkill]);
  logger.info({ skillCount: skillRegistry.size }, '运行时 Skill 已初始化');
}
