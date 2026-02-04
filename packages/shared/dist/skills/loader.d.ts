/**
 * Skills Loader for managing reusable agent instructions.
 */
import type { Skill, SkillMention } from '@anyapp/core';
/**
 * Loader for managing skills (reusable agent instructions).
 */
export declare class SkillsLoader {
    private skillsDir;
    /**
     * Creates a SkillsLoader instance.
     * @param skillsDir - The skills directory path
     */
    constructor(skillsDir: string);
    /**
     * Load all skills from the skills directory.
     * @returns Array of loaded skills
     */
    loadAll(): Promise<Skill[]>;
    /**
     * Load a specific skill by name.
     * @param name - The skill name
     * @returns The skill or null if not found
     */
    load(name: string): Promise<Skill | null>;
    /**
     * Save a skill.
     * @param skill - The skill to save
     */
    save(skill: Skill): Promise<void>;
    /**
     * Delete a skill.
     * @param name - The skill name to delete
     */
    delete(name: string): Promise<void>;
}
/**
 * Extract @mentions from a message.
 * @param message - The message to parse
 * @returns Array of skill mentions with positions
 */
export declare function extractSkillMentions(message: string): SkillMention[];
/**
 * Build system prompt with skill content injected.
 * @param basePrompt - The base system prompt
 * @param skills - Skills to inject
 * @returns System prompt with skill sections appended
 */
export declare function buildSystemPrompt(basePrompt: string, skills: Skill[]): string;
//# sourceMappingURL=loader.d.ts.map