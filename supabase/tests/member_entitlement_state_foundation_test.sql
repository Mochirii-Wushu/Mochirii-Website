begin;
select plan(77);

select has_table('private', 'member_entitlement_runtime_control', 'runtime controls exist');
select has_table('private', 'member_entitlement_subject_locks', 'subject locks exist');
select has_table('private', 'member_entitlement_events', 'event ledger exists');
select has_table('private', 'member_entitlement_state', 'current state exists');
select has_table('private', 'member_entitlement_event_targets', 'consumer delivery targets exist');
select has_table('private', 'member_entitlement_expiry_due', 'expiry due queue exists');

select is(
  (select string_agg(table_name, ',' order by table_name)
   from information_schema.tables
   where table_schema = 'private'
     and table_name like 'member_entitlement_%'),
  'member_entitlement_event_targets,member_entitlement_events,member_entitlement_expiry_due,member_entitlement_runtime_control,member_entitlement_state,member_entitlement_subject_locks',
  'the private entitlement table inventory is exact'
);

select is(
  (select count(*)::integer
   from unnest(array[
     'private.member_entitlement_runtime_control',
     'private.member_entitlement_subject_locks',
     'private.member_entitlement_events',
     'private.member_entitlement_state',
     'private.member_entitlement_event_targets',
     'private.member_entitlement_expiry_due'
   ]::text[]) as expected(qualified_name)
   where not (select relrowsecurity from pg_class where oid = expected.qualified_name::regclass)),
  0,
  'RLS is enabled on every entitlement table'
);

select is(
  (select count(*)::integer
   from unnest(array['anon', 'authenticated', 'service_role']) as role_name
   cross join unnest(array[
     'private.member_entitlement_runtime_control',
     'private.member_entitlement_subject_locks',
     'private.member_entitlement_events',
     'private.member_entitlement_state',
     'private.member_entitlement_event_targets',
     'private.member_entitlement_expiry_due'
   ]) as table_name
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as privilege_name
   where has_table_privilege(role_name, table_name, privilege_name)),
  0,
  'every direct table privilege is denied to client and service roles'
);

select is(
  (select string_agg(
     relation.relname || ':' || relation.relkind::text || ':' || relation.relpersistence::text || ':' ||
     relation.relrowsecurity::text || ':' || relation.relforcerowsecurity::text || ':' || owner_role.rolname,
     ',' order by relation.relname
   )
   from pg_class as relation
   join pg_namespace as namespace on namespace.oid = relation.relnamespace
   join pg_roles as owner_role on owner_role.oid = relation.relowner
   where namespace.nspname = 'private'
     and relation.relname like 'member_entitlement_%'
     and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')),
  'member_entitlement_event_targets:r:p:true:false:postgres,member_entitlement_events:r:p:true:false:postgres,member_entitlement_expiry_due:r:p:true:false:postgres,member_entitlement_runtime_control:r:p:true:false:postgres,member_entitlement_state:r:p:true:false:postgres,member_entitlement_subject_locks:r:p:true:false:postgres',
  'every entitlement relation has the exact kind, persistence, row-security mode, and owner'
);

select is(
  (with expected(relation_name, grantee_name, privilege_type, is_grantable) as (
     select relation_name, 'OWNER', privilege_type, false
     from unnest(array[
       'member_entitlement_runtime_control',
       'member_entitlement_subject_locks',
       'member_entitlement_events',
       'member_entitlement_state',
       'member_entitlement_event_targets',
       'member_entitlement_expiry_due'
     ]) as relation_name
     cross join unnest(array[
       'DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES',
       'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
     ]) as privilege_type
   ), actual as (
     select
       relation.relname as relation_name,
       case
         when grant_row.grantee = relation.relowner then 'OWNER'
         when grant_row.grantee = 0 then 'PUBLIC'
         else grantee.rolname
       end as grantee_name,
       grant_row.privilege_type,
       grant_row.is_grantable
     from pg_class as relation
     join pg_namespace as namespace on namespace.oid = relation.relnamespace
     cross join lateral aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) as grant_row
     left join pg_roles as grantee on grantee.oid = grant_row.grantee
     where namespace.nspname = 'private'
       and relation.relname like 'member_entitlement_%'
       and relation.relkind = 'r'
   )
   select count(*)::integer
   from (
     (select * from expected except all select * from actual)
     union all
     (select * from actual except all select * from expected)
   ) as difference),
  0,
  'entitlement table ACLs are exactly owner-only, non-grantable, including MAINTAIN'
);

select is(
  (select count(*)::integer
   from pg_attribute as attribute
   join pg_class as relation on relation.oid = attribute.attrelid
   join pg_namespace as namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'private'
     and relation.relname like 'member_entitlement_%'
     and attribute.attnum > 0
     and not attribute.attisdropped
     and attribute.attacl is not null),
  0,
  'entitlement columns have no column-level ACL entries'
);

select is(
  (select count(*)::integer
   from information_schema.columns
   where table_schema = 'private'
     and table_name like 'member_entitlement_%'),
  39,
  'the private entitlement schema has the exact bounded column count'
);

select is(
  (select string_agg(
     table_name || ':' || column_name || ':' || data_type || ':' || is_nullable || ':' ||
     coalesce(column_default, '<none>') || ':' || coalesce(generation_expression, '<none>'),
     ',' order by table_name, ordinal_position
   )
   from information_schema.columns
   where table_schema = 'private'
     and table_name like 'member_entitlement_%'),
  'member_entitlement_event_targets:event_id:uuid:NO:<none>:<none>,member_entitlement_event_targets:consumer:text:NO:<none>:<none>,member_entitlement_event_targets:required_at:timestamp with time zone:NO:clock_timestamp():<none>,member_entitlement_events:event_id:uuid:NO:gen_random_uuid():<none>,member_entitlement_events:subject:uuid:NO:<none>:<none>,member_entitlement_events:revision:bigint:NO:<none>:<none>,member_entitlement_events:active:boolean:NO:<none>:<none>,member_entitlement_events:discord_verified:boolean:NO:<none>:<none>,member_entitlement_events:verified_at:timestamp with time zone:YES:<none>:<none>,member_entitlement_events:expires_at:timestamp with time zone:YES:<none>:<none>,member_entitlement_events:entitled_at_effective_time:boolean:NO:<none>:(active AND discord_verified),member_entitlement_events:effective_at:timestamp with time zone:NO:<none>:<none>,member_entitlement_events:created_at:timestamp with time zone:NO:clock_timestamp():<none>,member_entitlement_expiry_due:subject:uuid:NO:<none>:<none>,member_entitlement_expiry_due:due_at:timestamp with time zone:NO:<none>:<none>,member_entitlement_expiry_due:expected_revision:bigint:NO:<none>:<none>,member_entitlement_expiry_due:expected_verified_at:timestamp with time zone:NO:<none>:<none>,member_entitlement_expiry_due:created_at:timestamp with time zone:NO:clock_timestamp():<none>,member_entitlement_expiry_due:updated_at:timestamp with time zone:NO:clock_timestamp():<none>,member_entitlement_runtime_control:singleton:boolean:NO:true:<none>,member_entitlement_runtime_control:producer_enabled:boolean:NO:false:<none>,member_entitlement_runtime_control:expiry_sweeper_enabled:boolean:NO:false:<none>,member_entitlement_runtime_control:social_dispatcher_enabled:boolean:NO:false:<none>,member_entitlement_runtime_control:forums_dispatcher_enabled:boolean:NO:false:<none>,member_entitlement_runtime_control:social_login_enabled:boolean:NO:false:<none>,member_entitlement_runtime_control:forums_login_enabled:boolean:NO:false:<none>,member_entitlement_runtime_control:updated_at:timestamp with time zone:NO:clock_timestamp():<none>,member_entitlement_state:subject:uuid:NO:<none>:<none>,member_entitlement_state:active:boolean:NO:<none>:<none>,member_entitlement_state:discord_verified:boolean:NO:<none>:<none>,member_entitlement_state:verified_at:timestamp with time zone:YES:<none>:<none>,member_entitlement_state:expires_at:timestamp with time zone:YES:<none>:<none>,member_entitlement_state:entitled_at_effective_time:boolean:NO:<none>:(active AND discord_verified),member_entitlement_state:revision:bigint:NO:<none>:<none>,member_entitlement_state:event_id:uuid:NO:<none>:<none>,member_entitlement_state:effective_at:timestamp with time zone:NO:<none>:<none>,member_entitlement_state:updated_at:timestamp with time zone:NO:clock_timestamp():<none>,member_entitlement_subject_locks:subject:uuid:NO:<none>:<none>,member_entitlement_subject_locks:created_at:timestamp with time zone:NO:clock_timestamp():<none>',
  'every private entitlement column name, type, nullability, default, and generated expression is exact'
);

select is(
  (select string_agg(table_name || ':' || column_name || ':' || is_generated, ',' order by table_name, ordinal_position)
   from information_schema.columns
   where table_schema = 'private'
     and table_name like 'member_entitlement_%'
     and (is_generated <> 'NEVER' or is_identity <> 'NO')),
  'member_entitlement_events:entitled_at_effective_time:ALWAYS,member_entitlement_state:entitled_at_effective_time:ALWAYS',
  'the exact generated-column and zero-identity inventory is frozen'
);

select is(
  (select string_agg(
     relation.relname || ':' || constraint_row.conname || ':' || constraint_row.contype::text || ':' ||
     pg_get_constraintdef(constraint_row.oid, true),
     ',' order by relation.relname, constraint_row.conname
   )
   from pg_constraint as constraint_row
   join pg_class as relation on relation.oid = constraint_row.conrelid
   join pg_namespace as namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'private'
     and relation.relname like 'member_entitlement_%'),
  'member_entitlement_event_targets:member_entitlement_event_targets_consumer_check:c:CHECK (consumer = ANY (ARRAY[''social''::text, ''forums''::text])),member_entitlement_event_targets:member_entitlement_event_targets_event_id_fkey:f:FOREIGN KEY (event_id) REFERENCES private.member_entitlement_events(event_id) ON DELETE RESTRICT,member_entitlement_event_targets:member_entitlement_event_targets_pkey:p:PRIMARY KEY (event_id, consumer),member_entitlement_events:member_entitlement_events_identity_key:u:UNIQUE (event_id, subject, revision),member_entitlement_events:member_entitlement_events_pkey:p:PRIMARY KEY (event_id),member_entitlement_events:member_entitlement_events_revision_check:c:CHECK (revision >= 1 AND revision <= ''9223372036854775807''::bigint),member_entitlement_events:member_entitlement_events_subject_revision_key:u:UNIQUE (subject, revision),member_entitlement_events:member_entitlement_events_verification_check:c:CHECK (discord_verified IS TRUE AND verified_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at = (verified_at + ''7 days''::interval) AND effective_at >= verified_at AND effective_at < expires_at OR discord_verified IS FALSE AND verified_at IS NULL AND expires_at IS NULL),member_entitlement_expiry_due:member_entitlement_expiry_due_pkey:p:PRIMARY KEY (subject),member_entitlement_expiry_due:member_entitlement_expiry_due_revision_check:c:CHECK (expected_revision >= 1 AND expected_revision <= ''9223372036854775807''::bigint),member_entitlement_expiry_due:member_entitlement_expiry_due_subject_fkey:f:FOREIGN KEY (subject) REFERENCES private.member_entitlement_state(subject) ON DELETE CASCADE,member_entitlement_runtime_control:member_entitlement_runtime_control_pkey:p:PRIMARY KEY (singleton),member_entitlement_runtime_control:member_entitlement_runtime_control_singleton_check:c:CHECK (singleton),member_entitlement_state:member_entitlement_state_event_fkey:f:FOREIGN KEY (event_id, subject, revision) REFERENCES private.member_entitlement_events(event_id, subject, revision) ON DELETE RESTRICT,member_entitlement_state:member_entitlement_state_event_id_key:u:UNIQUE (event_id),member_entitlement_state:member_entitlement_state_pkey:p:PRIMARY KEY (subject),member_entitlement_state:member_entitlement_state_revision_check:c:CHECK (revision >= 1 AND revision <= ''9223372036854775807''::bigint),member_entitlement_state:member_entitlement_state_subject_lock_fkey:f:FOREIGN KEY (subject) REFERENCES private.member_entitlement_subject_locks(subject) ON DELETE RESTRICT,member_entitlement_state:member_entitlement_state_verification_check:c:CHECK (discord_verified IS TRUE AND verified_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at = (verified_at + ''7 days''::interval) AND effective_at >= verified_at AND effective_at < expires_at OR discord_verified IS FALSE AND verified_at IS NULL AND expires_at IS NULL),member_entitlement_subject_locks:member_entitlement_subject_locks_pkey:p:PRIMARY KEY (subject)',
  'the complete entitlement constraint and foreign-key inventory is exact'
);

select is(
  (select count(*)::integer
   from pg_constraint as constraint_row
   join pg_class as relation on relation.oid = constraint_row.conrelid
   join pg_namespace as namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'private'
     and relation.relname like 'member_entitlement_%'
     and (constraint_row.condeferrable or constraint_row.condeferred or not constraint_row.convalidated)),
  0,
  'every entitlement constraint is immediate, nondeferrable, and validated'
);

select is(
  (select string_agg(
     tablename || ':' || indexname || ':' || regexp_replace(indexdef, E'\\s+', ' ', 'g'),
     ',' order by tablename, indexname
   )
   from pg_indexes
   where schemaname = 'private'
     and tablename like 'member_entitlement_%'),
  'member_entitlement_event_targets:member_entitlement_event_targets_pkey:CREATE UNIQUE INDEX member_entitlement_event_targets_pkey ON private.member_entitlement_event_targets USING btree (event_id, consumer),member_entitlement_events:member_entitlement_events_identity_key:CREATE UNIQUE INDEX member_entitlement_events_identity_key ON private.member_entitlement_events USING btree (event_id, subject, revision),member_entitlement_events:member_entitlement_events_pkey:CREATE UNIQUE INDEX member_entitlement_events_pkey ON private.member_entitlement_events USING btree (event_id),member_entitlement_events:member_entitlement_events_subject_effective_idx:CREATE INDEX member_entitlement_events_subject_effective_idx ON private.member_entitlement_events USING btree (subject, effective_at DESC),member_entitlement_events:member_entitlement_events_subject_revision_key:CREATE UNIQUE INDEX member_entitlement_events_subject_revision_key ON private.member_entitlement_events USING btree (subject, revision),member_entitlement_expiry_due:member_entitlement_expiry_due_order_idx:CREATE INDEX member_entitlement_expiry_due_order_idx ON private.member_entitlement_expiry_due USING btree (due_at, subject),member_entitlement_expiry_due:member_entitlement_expiry_due_pkey:CREATE UNIQUE INDEX member_entitlement_expiry_due_pkey ON private.member_entitlement_expiry_due USING btree (subject),member_entitlement_runtime_control:member_entitlement_runtime_control_pkey:CREATE UNIQUE INDEX member_entitlement_runtime_control_pkey ON private.member_entitlement_runtime_control USING btree (singleton),member_entitlement_state:member_entitlement_state_event_id_key:CREATE UNIQUE INDEX member_entitlement_state_event_id_key ON private.member_entitlement_state USING btree (event_id),member_entitlement_state:member_entitlement_state_pkey:CREATE UNIQUE INDEX member_entitlement_state_pkey ON private.member_entitlement_state USING btree (subject),member_entitlement_subject_locks:member_entitlement_subject_locks_pkey:CREATE UNIQUE INDEX member_entitlement_subject_locks_pkey ON private.member_entitlement_subject_locks USING btree (subject)',
  'the complete entitlement index inventory is exact'
);

select is(
  (select string_agg(
     table_relation.relname || ':' || index_relation.relname || ':' || index_row.indisunique::text || ':' ||
     index_row.indisprimary::text || ':' || index_row.indisvalid::text || ':' ||
     index_row.indisready::text || ':' || index_row.indislive::text || ':' ||
     index_row.indnullsnotdistinct::text,
     ',' order by table_relation.relname, index_relation.relname
   )
   from pg_index as index_row
   join pg_class as index_relation on index_relation.oid = index_row.indexrelid
   join pg_class as table_relation on table_relation.oid = index_row.indrelid
   join pg_namespace as namespace on namespace.oid = table_relation.relnamespace
   where namespace.nspname = 'private'
     and table_relation.relname like 'member_entitlement_%'),
  'member_entitlement_event_targets:member_entitlement_event_targets_pkey:true:true:true:true:true:false,member_entitlement_events:member_entitlement_events_identity_key:true:false:true:true:true:false,member_entitlement_events:member_entitlement_events_pkey:true:true:true:true:true:false,member_entitlement_events:member_entitlement_events_subject_effective_idx:false:false:true:true:true:false,member_entitlement_events:member_entitlement_events_subject_revision_key:true:false:true:true:true:false,member_entitlement_expiry_due:member_entitlement_expiry_due_order_idx:false:false:true:true:true:false,member_entitlement_expiry_due:member_entitlement_expiry_due_pkey:true:true:true:true:true:false,member_entitlement_runtime_control:member_entitlement_runtime_control_pkey:true:true:true:true:true:false,member_entitlement_state:member_entitlement_state_event_id_key:true:false:true:true:true:false,member_entitlement_state:member_entitlement_state_pkey:true:true:true:true:true:false,member_entitlement_subject_locks:member_entitlement_subject_locks_pkey:true:true:true:true:true:false',
  'every entitlement index has the exact uniqueness, primary, validity, readiness, live, and null-distinct modes'
);

select is(
  (select string_agg(
     tablename || ':' || policyname || ':' || permissive || ':' || array_to_string(roles, '+') || ':' ||
     cmd || ':' || coalesce(qual, '<none>') || ':' || coalesce(with_check, '<none>'),
     ',' order by tablename, policyname
   )
   from pg_policies
   where schemaname = 'private'
     and tablename like 'member_entitlement_%'),
  'member_entitlement_event_targets:member_entitlement_event_targets_client_deny:RESTRICTIVE:anon+authenticated:ALL:false:false,member_entitlement_events:member_entitlement_events_client_deny:RESTRICTIVE:anon+authenticated:ALL:false:false,member_entitlement_expiry_due:member_entitlement_expiry_due_client_deny:RESTRICTIVE:anon+authenticated:ALL:false:false,member_entitlement_runtime_control:member_entitlement_runtime_control_client_deny:RESTRICTIVE:anon+authenticated:ALL:false:false,member_entitlement_state:member_entitlement_state_client_deny:RESTRICTIVE:anon+authenticated:ALL:false:false,member_entitlement_subject_locks:member_entitlement_subject_locks_client_deny:RESTRICTIVE:anon+authenticated:ALL:false:false',
  'the complete restrictive entitlement policy inventory is exact'
);

select is(
  (select string_agg(
     relation.relname || ':' || trigger_row.tgname || ':' ||
     regexp_replace(pg_get_triggerdef(trigger_row.oid, true), E'\\s+', ' ', 'g'),
     ',' order by relation.relname, trigger_row.tgname
   )
   from pg_trigger as trigger_row
   join pg_class as relation on relation.oid = trigger_row.tgrelid
   join pg_namespace as namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'private'
     and relation.relname like 'member_entitlement_%'
     and not trigger_row.tgisinternal),
  'member_entitlement_events:member_entitlement_events_append_only:CREATE TRIGGER member_entitlement_events_append_only BEFORE DELETE OR UPDATE ON private.member_entitlement_events FOR EACH ROW EXECUTE FUNCTION private.reject_member_entitlement_event_mutation()',
  'the append-only trigger is the exact sole entitlement trigger'
);

select is(
  (select string_agg(
     relation.relname || ':' || trigger_row.tgname || ':' || trigger_row.tgenabled::text || ':' ||
     trigger_row.tgtype::text || ':' || trigger_row.tgconstraint::text || ':' ||
     function_namespace.nspname || '.' || function_row.proname || '(' ||
     pg_get_function_identity_arguments(function_row.oid) || ')',
     ',' order by relation.relname, trigger_row.tgname
   )
   from pg_trigger as trigger_row
   join pg_class as relation on relation.oid = trigger_row.tgrelid
   join pg_namespace as namespace on namespace.oid = relation.relnamespace
   join pg_proc as function_row on function_row.oid = trigger_row.tgfoid
   join pg_namespace as function_namespace on function_namespace.oid = function_row.pronamespace
   where namespace.nspname = 'private'
     and relation.relname like 'member_entitlement_%'
     and not trigger_row.tgisinternal),
  'member_entitlement_events:member_entitlement_events_append_only:O:27:0:private.reject_member_entitlement_event_mutation()',
  'the append-only trigger is enabled with the exact event mask and helper'
);

select is(
  (select string_agg(
     namespace.nspname || '.' || procedure.proname || '(' || pg_get_function_identity_arguments(procedure.oid) || '):' ||
     language.lanname || ':' || case when procedure.prosecdef then 'definer' else 'invoker' end || ':' ||
     procedure.provolatile::text || ':' || procedure.proparallel::text || ':' ||
     pg_get_function_result(procedure.oid) || ':' || pg_get_function_arguments(procedure.oid) || ':' ||
     coalesce(array_to_string(procedure.proconfig, '+'), '<none>'),
     ',' order by namespace.nspname, procedure.proname, pg_get_function_identity_arguments(procedure.oid)
   )
   from pg_proc as procedure
   join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   join pg_language as language on language.oid = procedure.prolang
   where namespace.nspname <> 'information_schema'
     and namespace.nspname !~ '^pg_'
     and procedure.prokind in ('f', 'p')
     and position('member_entitlement_' in lower(pg_get_functiondef(procedure.oid))) > 0),
  'private.process_member_entitlement_expiries_core_v1(p_now timestamp with time zone, p_limit integer):plpgsql:definer:v:u:TABLE(scanned_count integer, expired_count integer, superseded_count integer):p_now timestamp with time zone, p_limit integer DEFAULT 100:search_path="",private.reject_member_entitlement_event_mutation():plpgsql:invoker:v:u:trigger::search_path="",private.run_member_entitlement_expiry_sweep_v1():plpgsql:definer:v:u:void::search_path="",public.commit_member_entitlement_snapshot_core_v1(p_subject uuid, p_expected_revision bigint, p_active boolean, p_discord_verified boolean, p_verified_at timestamp with time zone, p_expires_at timestamp with time zone):plpgsql:definer:v:u:TABLE(result_subject uuid, result_revision bigint, result_event_id uuid, result_active boolean, result_discord_verified boolean, result_verified_at timestamp with time zone, result_expires_at timestamp with time zone, result_entitled_at_effective_time boolean, result_effective_at timestamp with time zone, result_changed boolean):p_subject uuid, p_expected_revision bigint, p_active boolean, p_discord_verified boolean, p_verified_at timestamp with time zone, p_expires_at timestamp with time zone:search_path=""',
  'the complete entitlement function signature, result, defaults, language, security mode, volatility, parallel mode, and search path is exact'
);

select is(
  (select string_agg(
     namespace.nspname || '.' || procedure.proname || '(' || pg_get_function_identity_arguments(procedure.oid) || '):' ||
     procedure.prokind::text || ':' || procedure.pronargs::text || ':' || procedure.pronargdefaults::text || ':' ||
     procedure.proisstrict::text || ':' || procedure.proleakproof::text || ':' || owner_role.rolname,
     ',' order by namespace.nspname, procedure.proname, pg_get_function_identity_arguments(procedure.oid)
   )
   from pg_proc as procedure
   join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   join pg_roles as owner_role on owner_role.oid = procedure.proowner
   where namespace.nspname <> 'information_schema'
     and namespace.nspname !~ '^pg_'
     and procedure.prokind in ('f', 'p')
     and position('member_entitlement_' in lower(pg_get_functiondef(procedure.oid))) > 0),
  'private.process_member_entitlement_expiries_core_v1(p_now timestamp with time zone, p_limit integer):f:2:1:false:false:postgres,private.reject_member_entitlement_event_mutation():f:0:0:false:false:postgres,private.run_member_entitlement_expiry_sweep_v1():f:0:0:false:false:postgres,public.commit_member_entitlement_snapshot_core_v1(p_subject uuid, p_expected_revision bigint, p_active boolean, p_discord_verified boolean, p_verified_at timestamp with time zone, p_expires_at timestamp with time zone):f:6:0:false:false:postgres',
  'the entitlement function inventory has exact kind, arity, defaults, strictness, leakproof mode, and owner'
);

select is(
  (select string_agg(
     namespace.nspname || '.' || procedure.proname || '(' || pg_get_function_identity_arguments(procedure.oid) || '):' ||
     case
       when grant_row.grantee = procedure.proowner then 'OWNER'
       when grant_row.grantee = 0 then 'PUBLIC'
       else grantee.rolname
     end || ':' || grant_row.privilege_type || ':' || grant_row.is_grantable::text,
     ',' order by namespace.nspname, procedure.proname, pg_get_function_identity_arguments(procedure.oid),
       case when grant_row.grantee = procedure.proowner then 'OWNER' when grant_row.grantee = 0 then 'PUBLIC' else grantee.rolname end
   )
   from pg_proc as procedure
   join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as grant_row
   left join pg_roles as grantee on grantee.oid = grant_row.grantee
   where namespace.nspname <> 'information_schema'
     and namespace.nspname !~ '^pg_'
     and procedure.prokind in ('f', 'p')
     and position('member_entitlement_' in lower(pg_get_functiondef(procedure.oid))) > 0
  ),
  'private.process_member_entitlement_expiries_core_v1(p_now timestamp with time zone, p_limit integer):OWNER:EXECUTE:false,private.reject_member_entitlement_event_mutation():OWNER:EXECUTE:false,private.run_member_entitlement_expiry_sweep_v1():OWNER:EXECUTE:false,public.commit_member_entitlement_snapshot_core_v1(p_subject uuid, p_expected_revision bigint, p_active boolean, p_discord_verified boolean, p_verified_at timestamp with time zone, p_expires_at timestamp with time zone):OWNER:EXECUTE:false,public.commit_member_entitlement_snapshot_core_v1(p_subject uuid, p_expected_revision bigint, p_active boolean, p_discord_verified boolean, p_verified_at timestamp with time zone, p_expires_at timestamp with time zone):service_role:EXECUTE:false',
  'function ACLs are exactly owner-only except the non-grantable service commit capability'
);

create schema entitlement_inventory_canary;

create function entitlement_inventory_canary.uppercase_reference()
returns bigint
language sql
set search_path = ''
as $$
  select count(*) from PRIVATE.MEMBER_ENTITLEMENT_STATE
$$;

select is(
  (select count(*)::integer
   from pg_proc as procedure
   join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'entitlement_inventory_canary'
     and procedure.proname = 'uppercase_reference'
     and position('member_entitlement_' in lower(pg_get_functiondef(procedure.oid))) > 0),
  1,
  'uppercase unquoted entitlement references remain inside the exact cross-schema function inventory boundary'
);

drop schema entitlement_inventory_canary cascade;

select is(
  (select owner_role.rolname || ':' ||
     coalesce((
       select string_agg(
         case
           when grant_row.grantee = namespace.nspowner then 'OWNER'
           when grant_row.grantee = 0 then 'PUBLIC'
           else grantee.rolname
         end || ':' || grant_row.privilege_type || ':' || grant_row.is_grantable::text,
         ',' order by
           case when grant_row.grantee = namespace.nspowner then 'OWNER' when grant_row.grantee = 0 then 'PUBLIC' else grantee.rolname end,
           grant_row.privilege_type
       )
       from aclexplode(coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))) as grant_row
       left join pg_roles as grantee on grantee.oid = grant_row.grantee
     ), '<none>')
   from pg_namespace as namespace
   join pg_roles as owner_role on owner_role.oid = namespace.nspowner
   where namespace.nspname = 'private'),
  'postgres:OWNER:CREATE:false,OWNER:USAGE:false,authenticated:USAGE:false,service_role:USAGE:false',
  'private schema owner and inherited usage ACLs remain exact with no client create capability'
);

select is(
  (select count(*)::integer
   from pg_default_acl as default_acl
   join pg_roles as owner_role on owner_role.oid = default_acl.defaclrole
   left join pg_namespace as namespace on namespace.oid = default_acl.defaclnamespace
   where owner_role.rolname = 'postgres'
     and (default_acl.defaclnamespace = 0 or namespace.nspname = 'private')),
  0,
  'default privileges cannot grant access to future private entitlement objects'
);

select is(
  (select count(*)::integer
   from pg_depend as dependency
   join pg_rewrite as rewrite_rule on rewrite_rule.oid = dependency.objid
   join pg_class as dependent_relation on dependent_relation.oid = rewrite_rule.ev_class
   join pg_namespace as dependent_namespace on dependent_namespace.oid = dependent_relation.relnamespace
   where dependency.refobjid in (
     'private.member_entitlement_runtime_control'::regclass,
     'private.member_entitlement_subject_locks'::regclass,
     'private.member_entitlement_events'::regclass,
     'private.member_entitlement_state'::regclass,
     'private.member_entitlement_event_targets'::regclass,
     'private.member_entitlement_expiry_due'::regclass
   )
     and dependent_relation.relkind in ('v', 'm')
     and dependent_namespace.nspname <> 'private'),
  0,
  'no external view or materialized view exposes an entitlement relation'
);

select is(
  (select count(*)::integer
   from pg_publication_tables as published
   where published.schemaname = 'private'
     and published.tablename in (
       'member_entitlement_runtime_control',
       'member_entitlement_subject_locks',
       'member_entitlement_events',
       'member_entitlement_state',
       'member_entitlement_event_targets',
       'member_entitlement_expiry_due'
     )),
  0,
  'no logical-replication publication contains an entitlement relation'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.commit_member_entitlement_snapshot_core_v1(uuid,bigint,boolean,boolean,timestamptz,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.commit_member_entitlement_snapshot_core_v1(uuid,bigint,boolean,boolean,timestamptz,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.commit_member_entitlement_snapshot_core_v1(uuid,bigint,boolean,boolean,timestamptz,timestamptz)',
    'execute'
  ),
  'only service_role can execute the inert commit RPC'
);

select ok(
  not has_function_privilege(
    'service_role',
    'private.process_member_entitlement_expiries_core_v1(timestamptz,integer)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.run_member_entitlement_expiry_sweep_v1()',
    'execute'
  ),
  'expiry implementation remains internal and uncallable by Data API roles'
);

select is(
  (select row(producer_enabled, expiry_sweeper_enabled, social_dispatcher_enabled,
              forums_dispatcher_enabled, social_login_enabled, forums_login_enabled)::text
   from private.member_entitlement_runtime_control where singleton),
  '(f,f,f,f,f,f)',
  'all runtime capabilities default false'
);

select is(
  (select count(*)::integer
   from cron.job
   where position(
     'member_entitlement_' in lower(coalesce(jobname, '') || ' ' || coalesce(command, ''))
   ) > 0),
  0,
  'no pg_cron job name or command references the entitlement foundation'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_ok(
  $$select * from public.commit_member_entitlement_snapshot_core_v1(
    '11111111-1111-4111-8111-111111111111', 0, true, false, null, null
  )$$,
  '55000',
  'Member entitlement commits are disabled.',
  'disabled commit RPC fails closed'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select * from public.commit_member_entitlement_snapshot_core_v1(
    '11111111-1111-4111-8111-111111111111', 0, true, false, null, null
  )$$,
  '42501',
  'Service role authorization is required.',
  'aggregate and legacy role disagreement fails closed'
);
select set_config('request.jwt.claim.role', '', true);

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(
  $$select * from public.commit_member_entitlement_snapshot_core_v1(
    '11111111-1111-4111-8111-111111111111', 0, true, false, null, null
  )$$,
  '42501',
  'Service role authorization is required.',
  'aggregate authenticated role cannot call the service RPC'
);

select set_config('request.jwt.claims', 'not-json', true);
select throws_ok(
  $$select * from public.commit_member_entitlement_snapshot_core_v1(
    '11111111-1111-4111-8111-111111111111', 0, true, false, null, null
  )$$,
  '42501',
  'Service role authorization is required.',
  'malformed aggregate claims fail closed'
);
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$select * from public.commit_member_entitlement_snapshot_core_v1(
    '11111111-1111-4111-8111-111111111111', 0, true, false, null, null
  )$$,
  '55000',
  'Member entitlement commits are disabled.',
  'legacy-only service role reaches the disabled capability gate'
);

select set_config('request.jwt.claim.role', '', true);
select throws_ok(
  $$select * from public.commit_member_entitlement_snapshot_core_v1(
    '11111111-1111-4111-8111-111111111111', 0, true, false, null, null
  )$$,
  '42501',
  'Service role authorization is required.',
  'missing aggregate and legacy claims fail closed'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

reset role;
update private.member_entitlement_runtime_control set producer_enabled = true where singleton;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_ok(
  $$select * from public.commit_member_entitlement_snapshot_core_v1(
    '11111111-1111-4111-8111-111111111111', 0, true, true, null, null
  )$$,
  '22004',
  'Verified entitlement timestamps are required.',
  'verified snapshots require both timestamps'
);

select throws_ok(
  $$select * from public.commit_member_entitlement_snapshot_core_v1(
    '11111111-1111-4111-8111-111111111111', 0, true, true,
    clock_timestamp() + interval '1 second', clock_timestamp() + interval '7 days 1 second'
  )$$,
  '22007',
  'Verified entitlement timestamps are invalid.',
  'future verification fails closed'
);

select throws_ok(
  $$select * from public.commit_member_entitlement_snapshot_core_v1(
    '11111111-1111-4111-8111-111111111111', 0, true, false,
    clock_timestamp() - interval '1 day', null
  )$$,
  '22007',
  'Denied entitlement timestamps must be null.',
  'denied snapshots cannot retain verification evidence'
);

select throws_ok(
  $$select * from public.commit_member_entitlement_snapshot_core_v1(
    '11111111-1111-4111-8111-111111111111', 1, true, false, null, null
  )$$,
  '40001',
  'Member entitlement revision conflict.',
  'first materialization requires expected revision zero'
);

select lives_ok(
  $$select * from public.commit_member_entitlement_snapshot_core_v1(
    '11111111-1111-4111-8111-111111111111', 0, true, false, null, null
  )$$,
  'the first denied snapshot commits through the service-only RPC'
);

reset role;

select is(
  (select revision from private.member_entitlement_state
   where subject = '11111111-1111-4111-8111-111111111111'),
  1::bigint,
  'initial revision is one'
);

select is(
  (select count(*)::integer from private.member_entitlement_events
   where subject = '11111111-1111-4111-8111-111111111111'),
  1,
  'first commit creates one immutable event'
);

select is(
  (select count(*)::integer from private.member_entitlement_event_targets
   where event_id = (select event_id from private.member_entitlement_state
                     where subject = '11111111-1111-4111-8111-111111111111')),
  2,
  'every event creates exactly one inert row for each required consumer'
);

select is(
  (select array_agg(consumer order by consumer)::text
   from private.member_entitlement_event_targets
   where event_id = (select event_id from private.member_entitlement_state
                     where subject = '11111111-1111-4111-8111-111111111111')),
  '{forums,social}',
  'required consumers are exact and bounded'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select lives_ok(
  $$select * from public.commit_member_entitlement_snapshot_core_v1(
    '11111111-1111-4111-8111-111111111111', 1, true, false, null, null
  )$$,
  'an exact replay succeeds idempotently'
);

reset role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  (select result_event_id
   from public.commit_member_entitlement_snapshot_core_v1(
     '11111111-1111-4111-8111-111111111111', 1, true, false, null, null
   )),
  null::uuid,
  'an exact replay returns no new event identifier'
);

reset role;

select is(
  (select count(*)::integer from private.member_entitlement_events
   where subject = '11111111-1111-4111-8111-111111111111'),
  1,
  'an exact replay creates no event'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  $$select * from public.commit_member_entitlement_snapshot_core_v1(
    '11111111-1111-4111-8111-111111111111', 1, false, false, null, null
  )$$,
  'a second distinct snapshot advances to revision two'
);
select throws_ok(
  $$select * from public.commit_member_entitlement_snapshot_core_v1(
    '11111111-1111-4111-8111-111111111111', 1, true, false, null, null
  )$$,
  '40001',
  'Member entitlement revision conflict.',
  'a stale non-adjacent replay cannot overwrite newer state'
);
reset role;

select is(
  (select row(state.revision, state.active, state.discord_verified,
              (select count(*) from private.member_entitlement_events as event
               where event.subject = state.subject),
              (select count(*) from private.member_entitlement_event_targets as target
               join private.member_entitlement_events as event on event.event_id = target.event_id
               where event.subject = state.subject),
              (select count(*) from private.member_entitlement_expiry_due as due
               where due.subject = state.subject))::text
   from private.member_entitlement_state as state
   where state.subject = '11111111-1111-4111-8111-111111111111'),
  '(2,f,f,2,4,0)',
  'failed replay preserves the newer snapshot and its exact event-target state'
);

insert into private.member_entitlement_runtime_control (singleton)
values (true)
on conflict (singleton) do update set producer_enabled = true;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select lives_ok(
  $$select * from public.commit_member_entitlement_snapshot_core_v1(
    '11111111-1111-4111-8111-111111111111', 2, true, true,
    transaction_timestamp() - interval '1 day',
    transaction_timestamp() + interval '6 days'
  )$$,
  'a current verified transition commits'
);

reset role;

select is(
  (select row(revision, active, discord_verified, entitled_at_effective_time)::text
   from private.member_entitlement_state
   where subject = '11111111-1111-4111-8111-111111111111'),
  '(3,t,t,t)',
  'the transition advances once and stores the exact decision'
);

select is(
  (select count(*)::integer
   from private.member_entitlement_expiry_due as due
   where due.subject = '11111111-1111-4111-8111-111111111111'
     and due.expected_revision = 3
     and due.expected_verified_at = transaction_timestamp() - interval '1 day'
     and due.due_at = transaction_timestamp() + interval '6 days'),
  1,
  'a grant stores exact expiry compare-and-swap evidence'
);

select throws_ok(
  $$update private.member_entitlement_events set active = false
    where subject = '11111111-1111-4111-8111-111111111111'$$,
  '55000',
  'Member entitlement events are append-only.',
  'event updates are rejected'
);

select throws_ok(
  $$delete from private.member_entitlement_events
    where subject = '11111111-1111-4111-8111-111111111111'$$,
  '55000',
  'Member entitlement events are append-only.',
  'event deletion is rejected'
);

update private.member_entitlement_runtime_control set expiry_sweeper_enabled = true where singleton;

select is(
  (select row(scanned_count, expired_count, superseded_count)::text
   from private.process_member_entitlement_expiries_core_v1(
     transaction_timestamp() + interval '6 days' - interval '1 second', 100
   )),
  '(0,0,0)',
  'a sweep before due time changes nothing'
);

select is(
  (select row(scanned_count, expired_count, superseded_count)::text
   from private.process_member_entitlement_expiries_core_v1(
     transaction_timestamp() + interval '6 days', 100
   )),
  '(1,1,0)',
  'the exact due instant denies once'
);

select is(
  (select row(revision, active, discord_verified, entitled_at_effective_time)::text
   from private.member_entitlement_state
   where subject = '11111111-1111-4111-8111-111111111111'),
  '(4,t,f,f)',
  'expiry preserves active state but revokes Discord verification'
);

select is(
  (select count(*)::integer from private.member_entitlement_expiry_due
   where subject = '11111111-1111-4111-8111-111111111111'),
  0,
  'completed expiry removes its due row'
);

select is(
  (select row(scanned_count, expired_count, superseded_count)::text
   from private.process_member_entitlement_expiries_core_v1(
     transaction_timestamp() + interval '7 days', 100
   )),
  '(0,0,0)',
  'a repeated expiry sweep emits no duplicate event'
);

select is(
  (select count(*)::integer from private.member_entitlement_events
   where subject = '11111111-1111-4111-8111-111111111111'),
  4,
  'transition history contains one row per effective decision only'
);

select is(
  (select count(*)::integer
   from private.member_entitlement_events as event
   left join lateral (
     select array_agg(target.consumer order by target.consumer) as consumers
     from private.member_entitlement_event_targets as target
     where target.event_id = event.event_id
   ) as delivery on true
   where delivery.consumers is distinct from array['forums', 'social']::text[]),
  0,
  'every event has exactly the complete bounded consumer target set'
);

select is(
  (select count(*)::integer
   from private.member_entitlement_state as state
   join private.member_entitlement_events as event on event.event_id = state.event_id
   where row(state.subject, state.revision, state.active, state.discord_verified,
             state.verified_at, state.expires_at, state.entitled_at_effective_time, state.effective_at)
     is distinct from
         row(event.subject, event.revision, event.active, event.discord_verified,
             event.verified_at, event.expires_at, event.entitled_at_effective_time, event.effective_at)),
  0,
  'current state is byte-semantic equal to its immutable event snapshot'
);

insert into private.member_entitlement_expiry_due (
  subject, due_at, expected_revision, expected_verified_at
) values (
  '11111111-1111-4111-8111-111111111111',
  transaction_timestamp() + interval '6 days',
  3,
  transaction_timestamp() - interval '1 day'
);

select is(
  (select row(scanned_count, expired_count, superseded_count)::text
   from private.process_member_entitlement_expiries_core_v1(
     transaction_timestamp() + interval '8 days', 100
   )),
  '(1,0,1)',
  'a stale due row is removed without emitting another decision'
);

select is(
  (select count(*)::integer from private.member_entitlement_events
   where subject = '11111111-1111-4111-8111-111111111111'),
  4,
  'stale expiry compare-and-swap emits no event'
);

select throws_ok(
  $$insert into private.member_entitlement_events (
      subject, revision, active, discord_verified, verified_at, expires_at, effective_at
    ) values (
      '22222222-2222-4222-8222-222222222222', 9223372036854775808,
      true, false, null, null, clock_timestamp()
    )$$,
  '22003',
  null,
  'revision overflow is rejected by PostgreSQL bigint'
);

insert into private.member_entitlement_subject_locks(subject)
values ('22222222-2222-4222-8222-222222222222');
insert into private.member_entitlement_events(
  event_id, subject, revision, active, discord_verified, verified_at, expires_at, effective_at
) values (
  '22222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222',
  9223372036854775807, true, false, null, null, clock_timestamp()
);
insert into private.member_entitlement_event_targets(event_id, consumer)
values
  ('22222222-2222-4222-8222-222222222221', 'social'),
  ('22222222-2222-4222-8222-222222222221', 'forums');
insert into private.member_entitlement_state(
  subject, active, discord_verified, verified_at, expires_at, revision, event_id, effective_at
) values (
  '22222222-2222-4222-8222-222222222222', true, false, null, null,
  9223372036854775807, '22222222-2222-4222-8222-222222222221', clock_timestamp()
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok(
  $$select * from public.commit_member_entitlement_snapshot_core_v1(
    '22222222-2222-4222-8222-222222222222', 9223372036854775807,
    false, false, null, null
  )$$,
  '22003',
  'Member entitlement revision is exhausted.',
  'maximum current revision cannot increment or wrap'
);
reset role;

insert into private.member_entitlement_subject_locks(subject)
values ('33333333-3333-4333-8333-333333333333');
insert into private.member_entitlement_events(
  event_id, subject, revision, active, discord_verified, verified_at, expires_at, effective_at
) values (
  '33333333-3333-4333-8333-333333333331', '33333333-3333-4333-8333-333333333333',
  9223372036854775807, true, true,
  transaction_timestamp() - interval '1 day',
  transaction_timestamp() + interval '6 days',
  transaction_timestamp()
);
insert into private.member_entitlement_state(
  subject, active, discord_verified, verified_at, expires_at, revision, event_id, effective_at
) values (
  '33333333-3333-4333-8333-333333333333', true, true,
  transaction_timestamp() - interval '1 day',
  transaction_timestamp() + interval '6 days',
  9223372036854775807, '33333333-3333-4333-8333-333333333331',
  transaction_timestamp()
);
insert into private.member_entitlement_event_targets(event_id, consumer)
values
  ('33333333-3333-4333-8333-333333333331', 'social'),
  ('33333333-3333-4333-8333-333333333331', 'forums');
insert into private.member_entitlement_expiry_due(
  subject, due_at, expected_revision, expected_verified_at
) values (
  '33333333-3333-4333-8333-333333333333',
  transaction_timestamp() + interval '6 days',
  9223372036854775807,
  transaction_timestamp() - interval '1 day'
);

select throws_ok(
  $$select * from private.process_member_entitlement_expiries_core_v1(
    transaction_timestamp() + interval '6 days', 100
  )$$,
  '22003',
  'Member entitlement revision is exhausted.',
  'maximum due revision cannot increment or wrap'
);

select is(
  (select row(
     state.revision,
     state.discord_verified,
     (select count(*) from private.member_entitlement_events as event
      where event.subject = state.subject),
     (select count(*) from private.member_entitlement_expiry_due as due
      where due.subject = state.subject),
     (select count(*) from private.member_entitlement_event_targets as target
      where target.event_id = state.event_id)
   )::text
   from private.member_entitlement_state as state
   where state.subject = '33333333-3333-4333-8333-333333333333'),
  '(9223372036854775807,t,1,1,2)',
  'maximum due revision cannot increment or partially mutate'
);

select is(
  (select count(*)::integer
   from private.member_entitlement_events as event
   left join lateral (
     select array_agg(target.consumer order by target.consumer) as consumers
     from private.member_entitlement_event_targets as target
     where target.event_id = event.event_id
   ) as delivery on true
   where delivery.consumers is distinct from array['forums', 'social']::text[]),
  0,
  'every fixture and runtime event retains exactly the complete consumer target set'
);

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name like 'member_entitlement%'
      and column_name in (
        'email', 'display_name', 'discord_roles', 'provider_metadata', 'raw_payload',
        'signature', 'secret', 'username', 'profile_url'
      )
  ),
  'entitlement tables contain no member profile, transport, provider, or secret payload columns'
);

select is(
  (select count(*)::integer
   from pg_trigger
   where not tgisinternal
     and tgrelid in (
       'private.member_entitlement_state'::regclass,
       'private.member_entitlement_event_targets'::regclass,
       'private.member_entitlement_expiry_due'::regclass
     )),
  0,
  'state, target, and due tables have no dispatcher triggers'
);

select * from finish();
rollback;
