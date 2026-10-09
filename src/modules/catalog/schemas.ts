import { z } from 'zod';
import { paginationQuery } from '../../shared/http/pagination.js';

const text = z.string().trim().min(1).max(100);
const id = z.coerce.number().int().positive();

const isRealDate = (d: string): boolean => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
};
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate, 'not a real calendar date');

export const matchStatus = z.enum(['SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED']);

export const idParams = z.object({ id });

export const competitionsQuery = paginationQuery.extend({
  q: text.optional().describe('Case-insensitive name search'),
  country: text.optional().describe('Exact country (case-insensitive)'),
  sort: z
    .enum(['name', '-name', 'country', '-country', 'id', '-id'])
    .default('name')
    .describe('Field to sort by; prefix with "-" for descending'),
});

export const seasonsQuery = paginationQuery.extend({
  competitionId: id.optional().describe('Filter by competition id'),
  sort: z.enum(['name', '-name', 'id', '-id']).default('-name'),
});

export const teamsQuery = paginationQuery.extend({
  q: text.optional().describe('Case-insensitive name search'),
  country: text.optional(),
  sort: z.enum(['name', '-name', 'country', '-country', 'id', '-id']).default('name'),
});

export const matchesQuery = paginationQuery
  .extend({
    seasonId: id.optional(),
    teamId: id.optional().describe('Matches where the team played home or away'),
    status: matchStatus.optional(),
    from: dateOnly.optional().describe('Kickoff on or after this date (YYYY-MM-DD, UTC)'),
    to: dateOnly.optional().describe('Kickoff on or before this date (YYYY-MM-DD, UTC)'),
    sort: z.enum(['kickoff', '-kickoff', 'id', '-id']).default('kickoff'),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '"from" must not be after "to"',
    path: ['to'],
  });

export type CompetitionsQuery = z.infer<typeof competitionsQuery>;
export type SeasonsQuery = z.infer<typeof seasonsQuery>;
export type TeamsQuery = z.infer<typeof teamsQuery>;
export type MatchesQuery = z.infer<typeof matchesQuery>;

export const competitionSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  country: z.string().nullable(),
  source: z.string().describe('Data source code, e.g. statsbomb-open-data'),
});

export const seasonSchema = z.object({
  id: z.number().int(),
  competitionId: z.number().int(),
  competitionName: z.string(),
  name: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
});

export const teamSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  country: z.string().nullable(),
  source: z.string(),
});
export const teamDetailSchema = teamSchema.extend({
  matchCount: z.number().int().describe('Matches played (home or away)'),
});

const teamRef = z.object({ id: z.number().int(), name: z.string() });

export const matchSummarySchema = z.object({
  id: z.number().int(),
  seasonId: z.number().int(),
  kickoffAt: z.string().describe('ISO 8601. Source gives local stadium time; stored as UTC (approximation).'),
  status: matchStatus,
  homeScore: z.number().int().nullable(),
  awayScore: z.number().int().nullable(),
  homeTeam: teamRef,
  awayTeam: teamRef,
});
export const matchDetailSchema = matchSummarySchema.extend({
  season: teamRef,
  competition: teamRef,
  source: z.string(),
  updatedAt: z.string(),
});

export type Competition = z.infer<typeof competitionSchema>;
export type Season = z.infer<typeof seasonSchema>;
export type Team = z.infer<typeof teamSchema>;
export type TeamDetail = z.infer<typeof teamDetailSchema>;
export type MatchSummary = z.infer<typeof matchSummarySchema>;
export type MatchDetail = z.infer<typeof matchDetailSchema>;
