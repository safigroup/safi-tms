-- Urgent fix: 20260819093255 used CREATE OR REPLACE FUNCTION to add
-- p_org/p_user as new trailing default parameters to cancel_invoice,
-- raise_invoice, and log_border_event. That does NOT replace the function
-- in Postgres when the argument list changes -- it creates a SECOND,
-- overloaded function alongside the original. PostgREST then cannot
-- disambiguate an RPC call whose supplied parameters are compatible with
-- both overloads (e.g. the old app's calls, which never pass p_org),
-- and returns PGRST203 "Could not choose the best candidate function".
-- This broke cancel_invoice/raise_invoice/log_border_event on the live
-- index.html app the moment 20260819093255 was applied to production.
--
-- Fix: explicitly drop the old, now-superseded signatures. The new
-- signatures (with p_org/p_user as optional trailing parameters) already
-- fully support the old calling convention on their own -- the problem was
-- never the new signature's design, only that the old one was left in
-- place as a second, ambiguous overload.

drop function if exists public.cancel_invoice(uuid, text);
drop function if exists public.raise_invoice(uuid, text);
drop function if exists public.log_border_event(uuid, text, text, jsonb);
