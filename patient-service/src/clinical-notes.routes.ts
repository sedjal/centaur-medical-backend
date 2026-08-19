import { z } from 'zod';
import {
  getClientIp,
  handleRouteError,
  parseBody,
  readInternalUserWithSession,
  reply,
} from '@centaur/shared';
import * as clinicalNotesService from './clinical-notes.service';

type RouteService = {
  get: (path: string, handler: (req: unknown, res: unknown) => Promise<void> | void) => void;
  post: (path: string, handler: (req: unknown, res: unknown) => Promise<void> | void) => void;
  delete: (path: string, handler: (req: unknown, res: unknown) => Promise<void> | void) => void;
};

type ReqLike = {
  headers?: Record<string, string | string[] | undefined>;
  params?: { id?: string; noteId?: string };
  body?: unknown;
  ip?: string;
  connection?: { remoteAddress?: string };
};

type ResLike = {
  statusCode?: number;
  setHeader: (k: string, v: string) => void;
  end: (chunk?: string | Buffer) => void;
};

const createSchema = z.object({
  title: z.string(),
  body: z.string(),
});

export function registerClinicalNoteRoutes(service: RouteService): void {
  service.get('/patients/:id/clinical-notes', async (req, res) => {
    try {
      const user = await readInternalUserWithSession(
        (req as ReqLike).headers as Record<string, string | string[] | undefined>
      );
      const id = String((req as ReqLike).params?.id || '');
      reply(res as ResLike, 200, await clinicalNotesService.listPatientClinicalNotes(user, id));
    } catch (err) {
      handleRouteError(res as ResLike, err);
    }
  });

  service.get('/patients/:id/clinical-notes/:noteId', async (req, res) => {
    try {
      const user = await readInternalUserWithSession(
        (req as ReqLike).headers as Record<string, string | string[] | undefined>
      );
      const typed = req as ReqLike;
      reply(
        res as ResLike,
        200,
        await clinicalNotesService.getPatientClinicalNote(
          user,
          String(typed.params?.id || ''),
          String(typed.params?.noteId || '')
        )
      );
    } catch (err) {
      handleRouteError(res as ResLike, err);
    }
  });

  service.post('/patients/:id/clinical-notes', async (req, res) => {
    try {
      const typed = req as ReqLike;
      const user = await readInternalUserWithSession(
        typed.headers as Record<string, string | string[] | undefined>
      );
      const id = String(typed.params?.id || '');
      const body = createSchema.parse(parseBody(typed));
      const created = await clinicalNotesService.createPatientClinicalNote(
        user,
        id,
        body,
        getClientIp(typed)
      );
      reply(res as ResLike, 201, created);
    } catch (err) {
      handleRouteError(res as ResLike, err);
    }
  });

  service.delete('/patients/:id/clinical-notes/:noteId', async (req, res) => {
    try {
      const typed = req as ReqLike;
      const user = await readInternalUserWithSession(
        typed.headers as Record<string, string | string[] | undefined>
      );
      reply(
        res as ResLike,
        200,
        await clinicalNotesService.deletePatientClinicalNote(
          user,
          String(typed.params?.id || ''),
          String(typed.params?.noteId || ''),
          getClientIp(typed)
        )
      );
    } catch (err) {
      handleRouteError(res as ResLike, err);
    }
  });
}
