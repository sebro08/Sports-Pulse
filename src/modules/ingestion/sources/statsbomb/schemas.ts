import { z } from 'zod';

// Los campos desconocidos se descartan (z.object elimina claves extra por defecto).

export const competitionEntrySchema = z.object({
  competition_id: z.number().int().positive(),
  season_id: z.number().int().positive(),
  country_name: z.string().nullish(),
  competition_name: z.string().min(1),
  season_name: z.string().min(1),
});
export type CompetitionEntry = z.infer<typeof competitionEntrySchema>;

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    // Date.parse "rueda" fechas imposibles (02-30 -> 03-02), asi que se compara ida y vuelta.
    const t = Date.parse(`${d}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
  }, 'not a real calendar date');

export const matchSchema = z
  .object({
    match_id: z.number().int().positive(),
    match_date: dateString,
    kick_off: z
      .string()
      .regex(/^\d{2}:\d{2}:\d{2}(\.\d+)?$/)
      .nullish(),
    home_score: z.number().int().min(0).nullish(),
    away_score: z.number().int().min(0).nullish(),
    home_team: z.object({
      home_team_id: z.number().int().positive(),
      home_team_name: z.string().min(1),
      country: z.object({ name: z.string() }).nullish(),
    }),
    away_team: z.object({
      away_team_id: z.number().int().positive(),
      away_team_name: z.string().min(1),
      country: z.object({ name: z.string() }).nullish(),
    }),
  })
  .refine((m) => m.home_team.home_team_id !== m.away_team.away_team_id, {
    message: 'home and away team must differ',
  });
export type StatsBombMatch = z.infer<typeof matchSchema>;
