import type {
  FastifySchema,
  FastifySchemaCompiler,
  FastifySerializerCompiler,
  FastifyTypeProvider,
} from 'fastify';
import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export interface ZodTypeProvider extends FastifyTypeProvider {
  validator: this['schema'] extends ZodTypeAny ? z.output<this['schema']> : unknown;
  serializer: this['schema'] extends ZodTypeAny ? z.input<this['schema']> : unknown;
}

const isZod = (value: unknown): value is ZodTypeAny =>
  typeof value === 'object' && value !== null && typeof (value as ZodTypeAny).safeParse === 'function';

export const validatorCompiler: FastifySchemaCompiler<unknown> =
  ({ schema }) =>
  (data) => {
    if (!isZod(schema)) return { value: data };
    const result = schema.safeParse(data);
    return result.success ? { value: result.data } : { error: result.error };
  };

export const serializerCompiler: FastifySerializerCompiler<unknown> =
  ({ schema }) =>
  (data) =>
    JSON.stringify(isZod(schema) ? schema.parse(data) : data);

const toJsonSchema = (schema: unknown): unknown => {
  if (!isZod(schema)) return schema;
  const json = zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  return json;
};

export const jsonSchemaTransform = ({
  schema,
  url,
}: {
  schema: FastifySchema;
  url: string;
}): { schema: FastifySchema; url: string } => {
  if (!schema) return { schema, url };
  const { response, headers, querystring, body, params, ...rest } = schema as Record<
    string,
    unknown
  >;
  const out: Record<string, unknown> = { ...rest };
  if (headers) out.headers = toJsonSchema(headers);
  if (querystring) out.querystring = toJsonSchema(querystring);
  if (body) out.body = toJsonSchema(body);
  if (params) out.params = toJsonSchema(params);
  if (response) {
    out.response = Object.fromEntries(
      Object.entries(response as Record<string, unknown>).map(([status, s]) => [
        status,
        toJsonSchema(s),
      ]),
    );
  }
  return { schema: out as FastifySchema, url };
};
