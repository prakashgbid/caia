-- @caia/pipeline-conductor — 005_conductor_notify_triggers.sql
-- pg_notify on conductor_escalations INSERT and UPDATE-close.

CREATE OR REPLACE FUNCTION caia_meta.notify_conductor_escalation()
RETURNS trigger AS $$
DECLARE
  v_tenant TEXT;
  v_kind   TEXT;
  v_payload TEXT;
BEGIN
  SELECT tenant_id INTO v_tenant
  FROM caia_meta.tenant_projects WHERE id = NEW.project_id;

  IF TG_OP = 'INSERT' THEN
    v_kind := 'escalation-opened';
  ELSIF TG_OP = 'UPDATE' AND OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL THEN
    v_kind := 'escalation-closed';
  ELSE
    RETURN NEW;
  END IF;

  v_payload := json_build_object(
    'kind', v_kind,
    'escalation_id', NEW.id,
    'project_id', NEW.project_id,
    'stage', NEW.stage,
    'reason', NEW.reason,
    'resolution', NEW.resolution
  )::text;

  PERFORM pg_notify('conductor:project:' || NEW.project_id::text, v_payload);
  PERFORM pg_notify('conductor:tenant:'  || COALESCE(v_tenant,'unknown'), v_payload);
  PERFORM pg_notify('conductor:platform', v_payload);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS conductor_escalations_notify_trg
  ON caia_meta.conductor_escalations;
CREATE TRIGGER conductor_escalations_notify_trg
  AFTER INSERT OR UPDATE ON caia_meta.conductor_escalations
  FOR EACH ROW EXECUTE FUNCTION caia_meta.notify_conductor_escalation();
