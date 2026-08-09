import { z } from 'zod'

import { WorkspaceRole } from '@/types/auth'
import { ProjectStatus } from '@/types/project'
import { TaskPriority, TaskStatus } from '@/types/task'

/**
 * Creation form schemas. (CLAUDE.md §63)
 *
 * As with the auth schemas, the form types are *derived* from these, so a rule
 * and its type cannot drift apart.
 *
 * Empty optional text fields come out of a form as `''`, never as `null`. Each
 * one is normalised here so the API layer always receives `null` for "not set"
 * — otherwise the backend has to guess whether an empty string means "cleared"
 * or "never filled in".
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((value) => (value === '' ? null : value))

/** `<input type="date">` gives `''` when empty and `YYYY-MM-DD` otherwise. */
const optionalDate = z
  .string()
  .refine((value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Enter a valid date.')
  .transform((value) => (value === '' ? null : value))

/** `<select>` uses `''` for "unassigned"; the API expects null. */
const optionalId = z.string().transform((value) => (value === '' ? null : value))

export const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Give the project a name.')
    .max(80, 'That name is too long.'),
  description: optionalText(280),
  status: z.enum([
    ProjectStatus.Planning,
    ProjectStatus.Active,
    ProjectStatus.OnHold,
    ProjectStatus.Completed,
  ]),
  dueDate: optionalDate,
})

export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Give the workspace a name.')
    .max(60, 'That name is too long.'),
  description: optionalText(200),
})

export const createDocumentSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Give the document a title.')
    .max(120, 'That title is too long.'),
  projectId: optionalId,
})

export const createTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, 'Describe the task.')
    .max(160, 'That title is too long.'),
  description: optionalText(2000),
  // Required: a task with no project has nowhere to roll up into, which breaks
  // every progress figure that depends on it.
  projectId: z.string().min(1, 'Pick a project.'),
  status: z.enum([TaskStatus.Todo, TaskStatus.InProgress, TaskStatus.Review, TaskStatus.Done]),
  priority: z.enum([
    TaskPriority.Urgent,
    TaskPriority.High,
    TaskPriority.Medium,
    TaskPriority.Low,
  ]),
  assigneeId: optionalId,
  dueDate: optionalDate,
})

export const inviteMemberSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter an email address.')
    // `z.email()` rather than a hand-rolled pattern: address validation is a
    // famously deep rabbit hole and the server verifies it properly anyway by
    // trying to deliver to it.
    .pipe(z.email('Enter a valid email address.'))
    .transform((value) => value.toLowerCase()),
  // Owner is not offered on invitation — see InviteMemberForm.
  role: z.enum([WorkspaceRole.Editor, WorkspaceRole.Viewer]),
})

export const updateWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Give the workspace a name.')
    .max(60, 'That name is too long.'),
  description: optionalText(200),
})

export type CreateWorkspaceFormValues = z.input<typeof createWorkspaceSchema>
export type CreateProjectFormValues = z.input<typeof createProjectSchema>
export type CreateDocumentFormValues = z.input<typeof createDocumentSchema>
export type CreateTaskFormValues = z.input<typeof createTaskSchema>
export type InviteMemberFormValues = z.input<typeof inviteMemberSchema>
export type UpdateWorkspaceFormValues = z.input<typeof updateWorkspaceSchema>
