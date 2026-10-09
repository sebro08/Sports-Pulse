import type { FastifyPluginAsync } from 'fastify';
import type { Cache } from '../../shared/cache/types.js';
import type { Queryable } from '../../shared/database/queryable.js';
import { errorResponseSchema } from '../../shared/http/errors.js';
import { pagedSchema } from '../../shared/http/pagination.js';
import type { ZodTypeProvider } from '../../shared/http/zod-provider.js';
import {
  competitionSchema,
  competitionsQuery,
  idParams,
  matchDetailSchema,
  matchesQuery,
  matchSummarySchema,
  seasonSchema,
  seasonsQuery,
  teamDetailSchema,
  teamSchema,
  teamsQuery,
} from './schemas.js';
import * as service from './service.js';
import type { CacheTtl } from './service.js';

const tags = ['catalog'];
const errors = { 400: errorResponseSchema };
const errorsWithNotFound = { 400: errorResponseSchema, 404: errorResponseSchema };

export interface CatalogRouteOptions {
  db: Queryable;
  cache: Cache;
  ttl: CacheTtl;
}

export const catalogRoutes: FastifyPluginAsync<CatalogRouteOptions> = async (app, { db, cache, ttl }) => {
  const deps = { db, cache, ttl };
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/competitions',
    {
      schema: {
        tags,
        summary: 'List competitions',
        querystring: competitionsQuery,
        response: { 200: pagedSchema(competitionSchema), ...errors },
      },
    },
    (req) => service.listCompetitions(deps, req.query),
  );

  r.get(
    '/seasons',
    {
      schema: {
        tags,
        summary: 'List seasons',
        querystring: seasonsQuery,
        response: { 200: pagedSchema(seasonSchema), ...errors },
      },
    },
    (req) => service.listSeasons(deps, req.query),
  );

  r.get(
    '/teams',
    {
      schema: {
        tags,
        summary: 'List teams',
        querystring: teamsQuery,
        response: { 200: pagedSchema(teamSchema), ...errors },
      },
    },
    (req) => service.listTeams(deps, req.query),
  );

  r.get(
    '/teams/:id',
    {
      schema: {
        tags,
        summary: 'Get a team',
        params: idParams,
        response: { 200: teamDetailSchema, ...errorsWithNotFound },
      },
    },
    (req) => service.getTeam(deps, req.params.id),
  );

  r.get(
    '/matches',
    {
      schema: {
        tags,
        summary: 'List matches',
        querystring: matchesQuery,
        response: { 200: pagedSchema(matchSummarySchema), ...errors },
      },
    },
    (req) => service.listMatches(deps, req.query),
  );

  r.get(
    '/matches/:id',
    {
      schema: {
        tags,
        summary: 'Get a match',
        params: idParams,
        response: { 200: matchDetailSchema, ...errorsWithNotFound },
      },
    },
    (req) => service.getMatch(deps, req.params.id),
  );
};
