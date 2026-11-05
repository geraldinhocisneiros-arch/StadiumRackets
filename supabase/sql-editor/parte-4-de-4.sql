-- Stadium Rackets — parte 4 de 4 (rode depois da parte 3)
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: stock_items Admins manage stock items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage stock items" ON public.stock_items TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: stock_movements Admins manage stock movements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage stock movements" ON public.stock_movements TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: court_availability_overrides Authenticated can read active availability overrides; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can read active availability overrides" ON public.court_availability_overrides FOR SELECT TO authenticated USING (((active = true) AND (cancelled_at IS NULL)));


--
-- Name: ideas Diretoria can create ideas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Diretoria can create ideas" ON public.ideas FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: ideas Diretoria can delete own ideas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Diretoria can delete own ideas" ON public.ideas FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: ideas Diretoria can update own ideas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Diretoria can update own ideas" ON public.ideas FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid()))) WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: account_entries Portal client reads account entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Portal client reads account entries" ON public.account_entries FOR SELECT TO authenticated USING (public.portal_can_view_client(client_id));


--
-- Name: monthly_charges Portal client reads monthly charges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Portal client reads monthly charges" ON public.monthly_charges FOR SELECT TO authenticated USING (public.portal_can_view_client(client_id));


--
-- Name: client_portal_users Portal client reads own link; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Portal client reads own link" ON public.client_portal_users FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: app_notifications Portal clients can update own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Portal clients can update own notifications" ON public.app_notifications FOR UPDATE TO authenticated USING (((client_id IS NOT NULL) AND (client_id IN ( SELECT portal_owned_client_ids.client_id
   FROM public.portal_owned_client_ids(auth.uid()) portal_owned_client_ids(client_id))))) WITH CHECK (((client_id IS NOT NULL) AND (client_id IN ( SELECT portal_owned_client_ids.client_id
   FROM public.portal_owned_client_ids(auth.uid()) portal_owned_client_ids(client_id)))));


--
-- Name: app_notifications Portal clients can view own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Portal clients can view own notifications" ON public.app_notifications FOR SELECT TO authenticated USING (((client_id IS NOT NULL) AND (client_id IN ( SELECT portal_owned_client_ids.client_id
   FROM public.portal_owned_client_ids(auth.uid()) portal_owned_client_ids(client_id)))));


--
-- Name: court_waitlist Portal owner select own waitlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Portal owner select own waitlist" ON public.court_waitlist FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: app_notifications Staff can delete app notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can delete app notifications" ON public.app_notifications FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: app_notifications Staff can insert app notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can insert app notifications" ON public.app_notifications FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: cash_closings Staff can insert cash closings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can insert cash closings" ON public.cash_closings FOR INSERT TO authenticated WITH CHECK (((closed_by = auth.uid()) AND ((cash_user_id IS NULL) OR public.auth_user_exists(cash_user_id)) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))));


--
-- Name: racket_loans Staff can insert racket loans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can insert racket loans" ON public.racket_loans FOR INSERT TO authenticated WITH CHECK (((lent_by = auth.uid()) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))));


--
-- Name: court_availability_overrides Staff can manage availability overrides; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can manage availability overrides" ON public.court_availability_overrides TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: app_notifications Staff can update app notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can update app notifications" ON public.app_notifications FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: racket_loans Staff can update racket loans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can update racket loans" ON public.racket_loans FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: app_notifications Staff can view app notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view app notifications" ON public.app_notifications FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: neurochat_message_logs Staff can view neurochat logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view neurochat logs" ON public.neurochat_message_logs FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: racket_loans Staff can view racket loans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view racket loans" ON public.racket_loans FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: waitlist_acknowledgements Staff insert own ack; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff insert own ack" ON public.waitlist_acknowledgements FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))));


--
-- Name: client_portal_users Staff manage portal users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage portal users" ON public.client_portal_users TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: court_waitlist Staff manage waitlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage waitlist" ON public.court_waitlist TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: waitlist_acknowledgements Staff view acks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff view acks" ON public.waitlist_acknowledgements FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: app_notifications Targeted user can update own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Targeted user can update own notifications" ON public.app_notifications FOR UPDATE TO authenticated USING (((user_id IS NOT NULL) AND (user_id = auth.uid()))) WITH CHECK (((user_id IS NOT NULL) AND (user_id = auth.uid())));


--
-- Name: app_notifications Targeted user can view own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Targeted user can view own notifications" ON public.app_notifications FOR SELECT TO authenticated USING (((user_id IS NOT NULL) AND (user_id = auth.uid())));


--
-- Name: app_notifications Teachers can insert app notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers can insert app notifications" ON public.app_notifications FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (client_id IS NOT NULL) AND (kind = ANY (ARRAY['professor_cancel'::text, 'professor_note'::text, 'aula_remarcada'::text])) AND (requires_ack IS NOT TRUE) AND ((client_id IN ( SELECT cs.client_id
   FROM (public.client_schedules cs
     JOIN public.teachers t ON ((t.id = cs.teacher_id)))
  WHERE ((t.user_id = auth.uid()) AND (cs.client_id IS NOT NULL)))) OR (client_id IN ( SELECT cb.client_id
   FROM (public.court_bookings cb
     JOIN public.teachers t ON ((t.id = cb.teacher_id)))
  WHERE ((t.user_id = auth.uid()) AND (cb.client_id IS NOT NULL)))))));


--
-- Name: court_waitlist Teachers delete own waitlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers delete own waitlist" ON public.court_waitlist FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (requested_by_teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid())))));


--
-- Name: court_waitlist Teachers insert waitlist for own students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers insert waitlist for own students" ON public.court_waitlist FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'professor'::public.app_role) AND ((requested_by_teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))) OR (client_id IN ( SELECT c.id
   FROM public.clients c
  WHERE (c.teacher_id IN ( SELECT teachers.id
           FROM public.teachers
          WHERE (teachers.user_id = auth.uid()))))))));


--
-- Name: court_waitlist Teachers update own waitlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers update own waitlist" ON public.court_waitlist FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (requested_by_teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))))) WITH CHECK ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (requested_by_teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid())))));


--
-- Name: court_waitlist Teachers view waitlist for own students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers view waitlist for own students" ON public.court_waitlist FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND ((requested_by_teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))) OR (client_id IN ( SELECT c.id
   FROM public.clients c
  WHERE (c.teacher_id IN ( SELECT teachers.id
           FROM public.teachers
          WHERE (teachers.user_id = auth.uid()))))))));


--
-- Name: account_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: account_entries ae_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ae_admin_all ON public.account_entries TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: account_entries ae_recep_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ae_recep_delete ON public.account_entries FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: account_entries ae_recep_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ae_recep_insert ON public.account_entries FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: account_entries ae_recep_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ae_recep_update ON public.account_entries FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: account_entries ae_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ae_select_staff ON public.account_entries FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: app_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings app_settings_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_settings_admin_write ON public.app_settings TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: app_settings app_settings_public_or_staff_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_settings_public_or_staff_read ON public.app_settings FOR SELECT TO authenticated USING ((public.app_settings_is_public_key(key) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: client_schedule_attendance attendance_delete_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_delete_staff ON public.client_schedule_attendance FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: client_schedule_attendance attendance_insert_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_insert_staff ON public.client_schedule_attendance FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: client_schedule_attendance attendance_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_select_staff ON public.client_schedule_attendance FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: client_schedule_attendance attendance_select_teacher_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_select_teacher_own ON public.client_schedule_attendance FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (client_schedule_id IN ( SELECT cs.id
   FROM (public.client_schedules cs
     JOIN public.teachers t ON ((t.id = cs.teacher_id)))
  WHERE (t.user_id = auth.uid())))));


--
-- Name: client_schedule_attendance attendance_update_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_update_staff ON public.client_schedule_attendance FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs audit_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_select_staff ON public.audit_logs FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: booking_confirmations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_confirmations ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_closings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cash_closings ENABLE ROW LEVEL SECURITY;

--
-- Name: client_categories cat_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cat_admin_all ON public.client_categories TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: client_categories cat_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cat_select_staff ON public.client_categories FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: court_booking_participants cbp_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cbp_staff_all ON public.court_booking_participants TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: court_booking_participants cbp_teacher_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cbp_teacher_own ON public.court_booking_participants FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (booking_id IN ( SELECT b.id
   FROM public.court_bookings b
  WHERE ((b.teacher_id IN ( SELECT teachers.id
           FROM public.teachers
          WHERE (teachers.user_id = auth.uid()))) OR (b.client_id IN ( SELECT cs.client_id
           FROM (public.client_schedules cs
             JOIN public.teachers t ON ((t.id = cs.teacher_id)))
          WHERE (t.user_id = auth.uid()))))))));


--
-- Name: client_followups cf_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cf_admin_all ON public.client_followups TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: client_followups cf_recep_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cf_recep_delete ON public.client_followups FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: client_followups cf_recep_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cf_recep_insert ON public.client_followups FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: client_followups cf_recep_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cf_recep_update ON public.client_followups FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: client_followups cf_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cf_select_staff ON public.client_followups FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: monthly_charges chg_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chg_admin_all ON public.monthly_charges TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: monthly_charges chg_recep_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chg_recep_update ON public.monthly_charges FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: monthly_charges chg_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chg_select_staff ON public.monthly_charges FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: cleaning_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cleaning_products ENABLE ROW LEVEL SECURITY;

--
-- Name: cleaning_products cleaning_products_diretoria_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cleaning_products_diretoria_all ON public.cleaning_products TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'limpeza'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'limpeza'::public.app_role)));


--
-- Name: cleaning_purchases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cleaning_purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: cleaning_purchases cleaning_purchases_diretoria_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cleaning_purchases_diretoria_all ON public.cleaning_purchases TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'limpeza'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'limpeza'::public.app_role)));


--
-- Name: cleaning_suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cleaning_suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: cleaning_suppliers cleaning_suppliers_diretoria_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cleaning_suppliers_diretoria_all ON public.cleaning_suppliers TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'limpeza'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'limpeza'::public.app_role)));


--
-- Name: cleaning_weekly_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cleaning_weekly_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: cleaning_weekly_usage cleaning_weekly_usage_diretoria_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cleaning_weekly_usage_diretoria_all ON public.cleaning_weekly_usage TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'limpeza'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'limpeza'::public.app_role)));


--
-- Name: clients cli_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cli_admin_all ON public.clients TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: clients cli_diretoria_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cli_diretoria_delete ON public.clients FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'diretoria'::public.app_role));


--
-- Name: clients cli_recep_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cli_recep_delete ON public.clients FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: clients cli_recep_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cli_recep_insert ON public.clients FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: clients cli_recep_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cli_recep_update ON public.clients FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: clients cli_select_portal; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cli_select_portal ON public.clients FOR SELECT TO authenticated USING (public.portal_can_view_client(id));


--
-- Name: clients cli_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cli_select_staff ON public.clients FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: client_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: client_followups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_followups ENABLE ROW LEVEL SECURITY;

--
-- Name: client_portal_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_portal_users ENABLE ROW LEVEL SECURITY;

--
-- Name: client_schedule_attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_schedule_attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: client_schedule_day_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_schedule_day_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: client_schedule_exceptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_schedule_exceptions ENABLE ROW LEVEL SECURITY;

--
-- Name: client_schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: client_teacher_link_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_teacher_link_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: client_teacher_link_requests client_teacher_link_requests_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_teacher_link_requests_staff_all ON public.client_teacher_link_requests TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: client_teacher_link_requests client_teacher_link_requests_teacher_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_teacher_link_requests_teacher_insert_own ON public.client_teacher_link_requests FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))) AND (requested_by = auth.uid()) AND (status = 'pendente'::text)));


--
-- Name: client_teacher_link_requests client_teacher_link_requests_teacher_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_teacher_link_requests_teacher_select_own ON public.client_teacher_link_requests FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid())))));


--
-- Name: client_teachers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_teachers ENABLE ROW LEVEL SECURITY;

--
-- Name: client_teachers client_teachers_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_teachers_staff_all ON public.client_teachers TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: client_teachers client_teachers_teacher_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_teachers_teacher_select_own ON public.client_teachers FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid())))));


--
-- Name: clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

--
-- Name: cobranca_followup_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cobranca_followup_events ENABLE ROW LEVEL SECURITY;

--
-- Name: cobranca_followups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cobranca_followups ENABLE ROW LEVEL SECURITY;

--
-- Name: court_availability_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.court_availability_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: court_booking_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.court_booking_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: court_bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.court_bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: court_waitlist; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.court_waitlist ENABLE ROW LEVEL SECURITY;

--
-- Name: client_schedule_day_notes csdn_professor_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY csdn_professor_select ON public.client_schedule_day_notes FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (EXISTS ( SELECT 1
   FROM (public.client_schedules cs
     JOIN public.teachers t ON ((t.id = cs.teacher_id)))
  WHERE ((cs.id = client_schedule_day_notes.client_schedule_id) AND (t.user_id = auth.uid()))))));


--
-- Name: client_schedule_day_notes csdn_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY csdn_staff_all ON public.client_schedule_day_notes TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: debt_limit_alert_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.debt_limit_alert_events ENABLE ROW LEVEL SECURITY;

--
-- Name: debt_limit_alert_events debt_limit_alert_events_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY debt_limit_alert_events_select ON public.debt_limit_alert_events FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: debt_limit_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.debt_limit_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: debt_limit_alerts debt_limit_alerts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY debt_limit_alerts_select ON public.debt_limit_alerts FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: debt_limit_exceptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.debt_limit_exceptions ENABLE ROW LEVEL SECURITY;

--
-- Name: debt_limit_exceptions debt_limit_exceptions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY debt_limit_exceptions_select ON public.debt_limit_exceptions FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: debt_limit_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.debt_limit_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: debt_limit_settings debt_limit_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY debt_limit_settings_select ON public.debt_limit_settings FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: debt_limit_settings debt_limit_settings_update_diretoria_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY debt_limit_settings_update_diretoria_only ON public.debt_limit_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'diretoria'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'diretoria'::public.app_role));


--
-- Name: fixed_court_waitlist; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fixed_court_waitlist ENABLE ROW LEVEL SECURITY;

--
-- Name: fixed_waitlist_court_hours; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fixed_waitlist_court_hours ENABLE ROW LEVEL SECURITY;

--
-- Name: fixed_waitlist_court_hours fixed_waitlist_court_hours_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_court_hours_select ON public.fixed_waitlist_court_hours FOR SELECT TO authenticated USING (true);


--
-- Name: fixed_waitlist_court_hours fixed_waitlist_court_hours_staff_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_court_hours_staff_write ON public.fixed_waitlist_court_hours TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: fixed_waitlist_court_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fixed_waitlist_court_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: fixed_waitlist_court_settings fixed_waitlist_court_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_court_settings_select ON public.fixed_waitlist_court_settings FOR SELECT TO authenticated USING (true);


--
-- Name: fixed_waitlist_court_settings fixed_waitlist_court_settings_staff_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_court_settings_staff_write ON public.fixed_waitlist_court_settings TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: fixed_court_waitlist fixed_waitlist_portal_client_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_portal_client_select ON public.fixed_court_waitlist FOR SELECT TO authenticated USING ((client_id IN ( SELECT client_portal_users.client_id
   FROM public.client_portal_users
  WHERE (client_portal_users.user_id = auth.uid()))));


--
-- Name: fixed_court_waitlist fixed_waitlist_staff_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_staff_delete ON public.fixed_court_waitlist FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: fixed_court_waitlist fixed_waitlist_staff_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_staff_insert ON public.fixed_court_waitlist FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: fixed_court_waitlist fixed_waitlist_staff_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_staff_select ON public.fixed_court_waitlist FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: fixed_court_waitlist fixed_waitlist_staff_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_staff_update ON public.fixed_court_waitlist FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: fixed_court_waitlist fixed_waitlist_teacher_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fixed_waitlist_teacher_select ON public.fixed_court_waitlist FOR SELECT TO authenticated USING ((requested_by_teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))));


--
-- Name: idea_comments ic_delete_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ic_delete_own_or_admin ON public.idea_comments FOR DELETE TO authenticated USING (((author_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: idea_comments ic_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ic_insert_own ON public.idea_comments FOR INSERT TO authenticated WITH CHECK (((author_id = auth.uid()) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))));


--
-- Name: idea_comments ic_select_diretoria_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ic_select_diretoria_admin ON public.idea_comments FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: idea_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.idea_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: ideas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;

--
-- Name: ideas ideas_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ideas_select_scoped ON public.ideas FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR (created_by = auth.uid())));


--
-- Name: monthly_charges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.monthly_charges ENABLE ROW LEVEL SECURITY;

--
-- Name: neurochat_message_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.neurochat_message_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: open_debt_reminder_actions odra_insert_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY odra_insert_staff ON public.open_debt_reminder_actions FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: open_debt_reminder_actions odra_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY odra_select_staff ON public.open_debt_reminder_actions FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: open_debt_reminder_actions odra_update_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY odra_update_staff ON public.open_debt_reminder_actions FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: online_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.online_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: online_payments online_payments_client_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY online_payments_client_select_own ON public.online_payments FOR SELECT TO authenticated USING ((client_id IN ( SELECT client_portal_users.client_id
   FROM public.client_portal_users
  WHERE (client_portal_users.user_id = auth.uid()))));


--
-- Name: online_payments online_payments_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY online_payments_staff_all ON public.online_payments FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: open_debt_reminder_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.open_debt_reminder_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_signups own pending row visible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own pending row visible" ON public.pending_signups FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: pending_client_signups own pending signup visible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own pending signup visible" ON public.pending_client_signups FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: payments pay_admin_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_admin_all_delete ON public.payments FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: payments pay_admin_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_admin_all_insert ON public.payments FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) AND ((commission_user_id IS NULL) OR (public.auth_user_exists(commission_user_id) AND (public.has_role(commission_user_id, 'admin'::public.app_role) OR public.has_role(commission_user_id, 'recepcionista'::public.app_role) OR public.has_role(commission_user_id, 'diretoria'::public.app_role) OR public.has_role(commission_user_id, 'professor'::public.app_role))))));


--
-- Name: payments pay_admin_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_admin_all_select ON public.payments FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: payments pay_admin_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_admin_all_update ON public.payments FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: payments pay_portal_client_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_portal_client_select ON public.payments FOR SELECT TO authenticated USING (public.portal_can_view_client(client_id));


--
-- Name: payments pay_recep_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_recep_delete ON public.payments FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: payments pay_recep_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_recep_insert ON public.payments FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'recepcionista'::public.app_role) AND (recorded_by = auth.uid()) AND ((commission_user_id IS NULL) OR (public.auth_user_exists(commission_user_id) AND (public.has_role(commission_user_id, 'admin'::public.app_role) OR public.has_role(commission_user_id, 'recepcionista'::public.app_role) OR public.has_role(commission_user_id, 'diretoria'::public.app_role) OR public.has_role(commission_user_id, 'professor'::public.app_role))))));


--
-- Name: payments pay_recep_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_recep_update ON public.payments FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'recepcionista'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'recepcionista'::public.app_role));


--
-- Name: payments pay_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_select_staff ON public.payments FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: payment_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_client_signups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pending_client_signups ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_signups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pending_signups ENABLE ROW LEVEL SECURITY;

--
-- Name: user_permissions perms_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY perms_admin_all ON public.user_permissions TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_permissions perms_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY perms_select_own ON public.user_permissions FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: portal_booking_failures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portal_booking_failures ENABLE ROW LEVEL SECURITY;

--
-- Name: portal_booking_failures portal_booking_failures_staff_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_booking_failures_staff_select ON public.portal_booking_failures FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: court_bookings portal_cancel_own_bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_cancel_own_bookings ON public.court_bookings FOR UPDATE TO authenticated USING (((client_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.client_portal_users cpu
  WHERE ((cpu.user_id = auth.uid()) AND (cpu.client_id = court_bookings.client_id)))))) WITH CHECK ((cancelled_at IS NOT NULL));


--
-- Name: court_bookings portal_select_bookings_for_map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_select_bookings_for_map ON public.court_bookings FOR SELECT TO authenticated USING ((client_id IN ( SELECT portal_owned_client_ids.client_id
   FROM public.portal_owned_client_ids(auth.uid()) portal_owned_client_ids(client_id))));


--
-- Name: court_bookings portal_select_own_bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_select_own_bookings ON public.court_bookings FOR SELECT TO authenticated USING (((client_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.client_portal_users cpu
  WHERE ((cpu.user_id = auth.uid()) AND (cpu.client_id = court_bookings.client_id))))));


--
-- Name: client_schedule_exceptions portal_select_schedule_exceptions_for_map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_select_schedule_exceptions_for_map ON public.client_schedule_exceptions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.client_schedules cs
  WHERE ((cs.id = client_schedule_exceptions.client_schedule_id) AND (cs.client_id IN ( SELECT portal_owned_client_ids.client_id
           FROM public.portal_owned_client_ids(auth.uid()) portal_owned_client_ids(client_id)))))));


--
-- Name: client_schedules portal_select_schedules_for_map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_select_schedules_for_map ON public.client_schedules FOR SELECT TO authenticated USING ((client_id IN ( SELECT portal_owned_client_ids.client_id
   FROM public.portal_owned_client_ids(auth.uid()) portal_owned_client_ids(client_id))));


--
-- Name: portal_signup_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portal_signup_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: price_table; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.price_table ENABLE ROW LEVEL SECURITY;

--
-- Name: price_table price_table_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY price_table_admin_all ON public.price_table TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: price_table price_table_select_portal; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY price_table_select_portal ON public.price_table FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.client_portal_users cpu
  WHERE (cpu.user_id = auth.uid()))));


--
-- Name: price_table price_table_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY price_table_select_staff ON public.price_table FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_admin_all ON public.profiles TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: profiles profiles_select_self_or_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_self_or_staff ON public.profiles FOR SELECT TO authenticated USING (((auth.uid() = id) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: profiles profiles_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id));


--
-- Name: racket_loans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.racket_loans ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_receipts receipts_delete_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY receipts_delete_auth ON public.payment_receipts FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: payment_receipts receipts_insert_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY receipts_insert_auth ON public.payment_receipts FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: payment_receipts receipts_select_portal; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY receipts_select_portal ON public.payment_receipts FOR SELECT TO authenticated USING (public.portal_can_view_client(client_id));


--
-- Name: payment_receipts receipts_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY receipts_select_staff ON public.payment_receipts FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: user_roles roles_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_admin_all ON public.user_roles TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles roles_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_select_own ON public.user_roles FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: client_schedule_exceptions sched_exc_staff_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_exc_staff_delete ON public.client_schedule_exceptions FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: client_schedule_exceptions sched_exc_staff_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_exc_staff_insert ON public.client_schedule_exceptions FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: client_schedule_exceptions sched_exc_staff_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_exc_staff_select ON public.client_schedule_exceptions FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: client_schedule_exceptions sched_exc_staff_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_exc_staff_update ON public.client_schedule_exceptions FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: client_schedules sched_staff_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_staff_delete ON public.client_schedules FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: client_schedules sched_staff_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_staff_insert ON public.client_schedules FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: client_schedules sched_staff_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_staff_select ON public.client_schedules FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: client_schedules sched_staff_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sched_staff_update ON public.client_schedules FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: pending_signups staff deletes pending; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff deletes pending" ON public.pending_signups FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: portal_signup_tokens staff manage signup tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff manage signup tokens" ON public.portal_signup_tokens TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: teacher_signup_tokens staff manage teacher signup tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff manage teacher signup tokens" ON public.teacher_signup_tokens TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: pending_signups staff sees all pending; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff sees all pending" ON public.pending_signups FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: pending_client_signups staff sees all pending client signups; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff sees all pending client signups" ON public.pending_client_signups FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: teacher_client_change_requests staff update requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff update requests" ON public.teacher_client_change_requests FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR ((requested_by = auth.uid()) AND (status = 'pendente'::text)))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR ((requested_by = auth.uid()) AND (status = ANY (ARRAY['pendente'::text, 'cancelada'::text])))));


--
-- Name: court_bookings staff_full_access_bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_full_access_bookings ON public.court_bookings TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: booking_confirmations staff_manage_booking_confirmations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_manage_booking_confirmations ON public.booking_confirmations TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: stock_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_items stock_items_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stock_items_select_staff ON public.stock_items FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: stock_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_movements stock_movements_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stock_movements_select_staff ON public.stock_movements FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: task_updates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_updates ENABLE ROW LEVEL SECURITY;

--
-- Name: task_updates task_updates_delete_author_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_updates_delete_author_admin ON public.task_updates FOR DELETE TO authenticated USING (((author_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: task_updates task_updates_insert_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_updates_insert_scoped ON public.task_updates FOR INSERT TO authenticated WITH CHECK (((author_id = auth.uid()) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_updates.task_id) AND ((t.created_by = auth.uid()) OR (t.assigned_to = auth.uid()))))))));


--
-- Name: task_updates task_updates_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_updates_select_scoped ON public.task_updates FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR (author_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_updates.task_id) AND ((t.created_by = auth.uid()) OR (t.assigned_to = auth.uid())))))));


--
-- Name: tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks tasks_delete_owner_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_delete_owner_admin ON public.tasks FOR DELETE TO authenticated USING (((created_by = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: tasks tasks_insert_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_insert_auth ON public.tasks FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));


--
-- Name: tasks tasks_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_select_scoped ON public.tasks FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR (created_by = auth.uid()) OR (assigned_to = auth.uid())));


--
-- Name: tasks tasks_update_owner_assignee_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_update_owner_assignee_admin ON public.tasks FOR UPDATE TO authenticated USING (((created_by = auth.uid()) OR (assigned_to = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: teacher_client_change_requests teacher own requests insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "teacher own requests insert" ON public.teacher_client_change_requests FOR INSERT TO authenticated WITH CHECK (((requested_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.teachers t
  WHERE ((t.id = teacher_client_change_requests.teacher_id) AND (t.user_id = auth.uid()))))));


--
-- Name: teacher_client_change_requests teacher own requests select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "teacher own requests select" ON public.teacher_client_change_requests FOR SELECT TO authenticated USING (((requested_by = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: teacher_client_change_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_client_change_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: court_bookings teacher_delete_own_cancelled_bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_delete_own_cancelled_bookings ON public.court_bookings FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (cancelled_at IS NOT NULL) AND (teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid())))));


--
-- Name: client_schedule_exceptions teacher_delete_own_sched_exceptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_delete_own_sched_exceptions ON public.client_schedule_exceptions FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (client_schedule_id IN ( SELECT cs.id
   FROM ((public.client_schedules cs
     LEFT JOIN public.clients c ON ((c.id = cs.client_id)))
     JOIN public.teachers t ON (((t.id = cs.teacher_id) OR (t.id = c.teacher_id))))
  WHERE (t.user_id = auth.uid())))));


--
-- Name: court_bookings teacher_insert_cancel_booking; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_insert_cancel_booking ON public.court_bookings FOR INSERT TO authenticated WITH CHECK (((cancelled_at IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.teachers t
  WHERE ((t.id = court_bookings.teacher_id) AND (t.user_id = auth.uid())))) AND ((client_id IS NULL) OR (client_id IN ( SELECT cs.client_id
   FROM (public.client_schedules cs
     JOIN public.teachers t2 ON ((t2.id = cs.teacher_id)))
  WHERE (t2.user_id = auth.uid()))))));


--
-- Name: client_schedule_exceptions teacher_insert_own_schedule_exceptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_insert_own_schedule_exceptions ON public.client_schedule_exceptions FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (client_schedule_id IN ( SELECT cs.id
   FROM ((public.client_schedules cs
     LEFT JOIN public.clients c ON ((c.id = cs.client_id)))
     JOIN public.teachers t ON (((t.id = cs.teacher_id) OR (t.id = c.teacher_id))))
  WHERE (t.user_id = auth.uid())))));


--
-- Name: court_bookings teacher_select_own_bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_select_own_bookings ON public.court_bookings FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND ((teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))) OR (client_id IN ( SELECT cs.client_id
   FROM (public.client_schedules cs
     JOIN public.teachers t ON ((t.id = cs.teacher_id)))
  WHERE (t.user_id = auth.uid()))))));


--
-- Name: clients teacher_select_own_clients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_select_own_clients ON public.clients FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND ((id IN ( SELECT cs.client_id
   FROM (public.client_schedules cs
     JOIN public.teachers t ON ((t.id = cs.teacher_id)))
  WHERE ((t.user_id = auth.uid()) AND (cs.client_id IS NOT NULL)))) OR (id IN ( SELECT cb.client_id
   FROM (public.court_bookings cb
     JOIN public.teachers t ON ((t.id = cb.teacher_id)))
  WHERE ((t.user_id = auth.uid()) AND (cb.client_id IS NOT NULL)))) OR (teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))) OR (id IN ( SELECT ct.client_id
   FROM (public.client_teachers ct
     JOIN public.teachers t ON ((t.id = ct.teacher_id)))
  WHERE (t.user_id = auth.uid()))))));


--
-- Name: client_schedule_exceptions teacher_select_own_sched_exceptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_select_own_sched_exceptions ON public.client_schedule_exceptions FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (client_schedule_id IN ( SELECT cs.id
   FROM ((public.client_schedules cs
     LEFT JOIN public.clients c ON ((c.id = cs.client_id)))
     JOIN public.teachers t ON (((t.id = cs.teacher_id) OR (t.id = c.teacher_id))))
  WHERE (t.user_id = auth.uid())))));


--
-- Name: client_schedule_exceptions teacher_select_own_schedule_exceptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_select_own_schedule_exceptions ON public.client_schedule_exceptions FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (client_schedule_id IN ( SELECT cs.id
   FROM (public.client_schedules cs
     JOIN public.teachers t ON ((t.id = cs.teacher_id)))
  WHERE (t.user_id = auth.uid())))));


--
-- Name: client_schedules teacher_select_own_schedules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_select_own_schedules ON public.client_schedules FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid())))));


--
-- Name: teachers teacher_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_select_self ON public.teachers FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND (user_id = auth.uid())));


--
-- Name: teacher_signup_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_signup_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: court_bookings teacher_toggle_own_bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_toggle_own_bookings ON public.court_bookings FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'professor'::public.app_role) AND ((teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))) OR (client_id IN ( SELECT cs.client_id
   FROM (public.client_schedules cs
     JOIN public.teachers t ON ((t.id = cs.teacher_id)))
  WHERE (t.user_id = auth.uid()))) OR (client_id IN ( SELECT c.id
   FROM (public.clients c
     JOIN public.teachers t ON ((t.id = c.teacher_id)))
  WHERE (t.user_id = auth.uid())))))) WITH CHECK ((public.has_role(auth.uid(), 'professor'::public.app_role) AND ((teacher_id IN ( SELECT teachers.id
   FROM public.teachers
  WHERE (teachers.user_id = auth.uid()))) OR (client_id IN ( SELECT cs.client_id
   FROM (public.client_schedules cs
     JOIN public.teachers t ON ((t.id = cs.teacher_id)))
  WHERE (t.user_id = auth.uid()))) OR (client_id IN ( SELECT c.id
   FROM (public.clients c
     JOIN public.teachers t ON ((t.id = c.teacher_id)))
  WHERE (t.user_id = auth.uid()))))));


--
-- Name: teachers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;

--
-- Name: teachers teachers_staff_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_staff_delete ON public.teachers FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: teachers teachers_staff_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_staff_insert ON public.teachers FOR INSERT TO authenticated WITH CHECK (((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)) AND ((user_id IS NULL) OR public.auth_user_exists(user_id))));


--
-- Name: teachers teachers_staff_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_staff_select ON public.teachers FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: teachers teachers_staff_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_staff_update ON public.teachers FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role)));


--
-- Name: user_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: waitlist_acknowledgements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waitlist_acknowledgements ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_notifications wn_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wn_admin_delete ON public.whatsapp_notifications FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: whatsapp_notifications wn_insert_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wn_insert_staff ON public.whatsapp_notifications FOR INSERT TO authenticated WITH CHECK (((sent_by = auth.uid()) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))));


--
-- Name: whatsapp_notifications wn_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wn_select_staff ON public.whatsapp_notifications FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: work_task_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_task_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: work_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: works; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.works ENABLE ROW LEVEL SECURITY;

--
-- Name: works works_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY works_admin_all ON public.works TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: works works_diretoria_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY works_diretoria_delete ON public.works FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: works works_diretoria_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY works_diretoria_insert ON public.works FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: works works_diretoria_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY works_diretoria_update ON public.works FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid()))) WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: works works_select_diretoria_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY works_select_diretoria_admin ON public.works FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: work_tasks wt_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wt_admin_all ON public.work_tasks TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: work_tasks wt_diretoria_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wt_diretoria_delete ON public.work_tasks FOR DELETE TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: work_tasks wt_diretoria_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wt_diretoria_insert ON public.work_tasks FOR INSERT TO authenticated WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: work_tasks wt_diretoria_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wt_diretoria_update ON public.work_tasks FOR UPDATE TO authenticated USING ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid()))) WITH CHECK ((public.has_role(auth.uid(), 'diretoria'::public.app_role) AND (created_by = auth.uid())));


--
-- Name: work_tasks wt_select_diretoria_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wt_select_diretoria_admin ON public.work_tasks FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: work_task_comments wtc_delete_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wtc_delete_own_or_admin ON public.work_task_comments FOR DELETE TO authenticated USING (((author_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: work_task_comments wtc_insert_admin_diretoria; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wtc_insert_admin_diretoria ON public.work_task_comments FOR INSERT TO authenticated WITH CHECK (((author_id = auth.uid()) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role))));


--
-- Name: work_task_comments wtc_select_admin_diretoria; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wtc_select_admin_diretoria ON public.work_task_comments FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));


--
-- Name: work_task_comments wtc_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wtc_update_own ON public.work_task_comments FOR UPDATE TO authenticated USING (((author_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK (((author_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: TABLE teacher_client_change_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.teacher_client_change_requests TO authenticated;
GRANT ALL ON TABLE public.teacher_client_change_requests TO service_role;


--
-- Name: FUNCTION _apply_client_change_request(r public.teacher_client_change_requests); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._apply_client_change_request(r public.teacher_client_change_requests) FROM PUBLIC;


--
-- Name: FUNCTION _client_belongs_to_teacher(_client_id uuid, _teacher_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._client_belongs_to_teacher(_client_id uuid, _teacher_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION _client_change_slot_occupant(_court integer, _date date, _start time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._client_change_slot_occupant(_court integer, _date date, _start time without time zone) FROM PUBLIC;


--
-- Name: FUNCTION _cobranca_is_staff(_uid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._cobranca_is_staff(_uid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public._cobranca_is_staff(_uid uuid) TO authenticated;


--
-- Name: FUNCTION _fixed_is_off_today(_schedule_id uuid, _date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._fixed_is_off_today(_schedule_id uuid, _date date) FROM PUBLIC;


--
-- Name: FUNCTION _fixed_waitlist_free_matches(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._fixed_waitlist_free_matches() FROM PUBLIC;


--
-- Name: FUNCTION _materialize_swapped_fixed(_ids uuid[], _date date, _to_court smallint, _from_court smallint, _mirror_client uuid, _mirror_start time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._materialize_swapped_fixed(_ids uuid[], _date date, _to_court smallint, _from_court smallint, _mirror_client uuid, _mirror_start time without time zone) FROM PUBLIC;


--
-- Name: FUNCTION _notify_professor_late_cancel(_event_key text, _client_id uuid, _teacher_name text, _court integer, _date date, _start time without time zone, _end time without time zone, _cancelled_at timestamp with time zone, _is_fixed boolean, _booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._notify_professor_late_cancel(_event_key text, _client_id uuid, _teacher_name text, _court integer, _date date, _start time without time zone, _end time without time zone, _cancelled_at timestamp with time zone, _is_fixed boolean, _booking_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION admin_save_client_schedule(_id uuid, _client_id uuid, _weekday integer, _start_time time without time zone, _end_time time without time zone, _court integer, _teacher_id uuid, _notes text, _valid_from date, _valid_until date, _group_ids uuid[], _replace_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_save_client_schedule(_id uuid, _client_id uuid, _weekday integer, _start_time time without time zone, _end_time time without time zone, _court integer, _teacher_id uuid, _notes text, _valid_from date, _valid_until date, _group_ids uuid[], _replace_ids uuid[]) TO authenticated;


--
-- Name: FUNCTION app_settings_is_public_key(_key text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.app_settings_is_public_key(_key text) TO authenticated;
GRANT ALL ON FUNCTION public.app_settings_is_public_key(_key text) TO anon;


--
-- Name: FUNCTION approve_client_change_request(_request_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.approve_client_change_request(_request_id uuid) TO authenticated;


--
-- Name: FUNCTION approve_pending_signup(target_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.approve_pending_signup(target_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_pending_signup(target_user uuid) TO authenticated;


--
-- Name: FUNCTION can_access_client_photo(_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_access_client_photo(_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_access_client_photo(_name text) TO service_role;
GRANT ALL ON FUNCTION public.can_access_client_photo(_name text) TO supabase_storage_admin;


--
-- Name: FUNCTION cleaning_delete_purchase(_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cleaning_delete_purchase(_id uuid) TO authenticated;


--
-- Name: FUNCTION cleaning_register_purchase(_product_id uuid, _quantity numeric, _unit_price numeric, _purchase_date date, _supplier_id uuid, _notes text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cleaning_register_purchase(_product_id uuid, _quantity numeric, _unit_price numeric, _purchase_date date, _supplier_id uuid, _notes text) TO authenticated;


--
-- Name: FUNCTION cleaning_update_purchase(_id uuid, _quantity numeric, _unit_price numeric, _purchase_date date, _supplier_id uuid, _notes text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cleaning_update_purchase(_id uuid, _quantity numeric, _unit_price numeric, _purchase_date date, _supplier_id uuid, _notes text) TO authenticated;


--
-- Name: FUNCTION client_account_balance(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.client_account_balance(_client_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.client_account_balance(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION client_account_balances(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.client_account_balances(_client_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.client_account_balances(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION client_family_month_end_projection(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.client_family_month_end_projection(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION client_month_end_projection(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.client_month_end_projection(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION client_next_month_projection(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.client_next_month_projection(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION client_open_debt_items(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.client_open_debt_items(_client_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.client_open_debt_items(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION client_schedule_exception_covers(_schedule_id uuid, _date date, _window_start time without time zone, _window_end time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.client_schedule_exception_covers(_schedule_id uuid, _date date, _window_start time without time zone, _window_end time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.client_schedule_exception_covers(_schedule_id uuid, _date date, _window_start time without time zone, _window_end time without time zone) TO authenticated;
GRANT ALL ON FUNCTION public.client_schedule_exception_covers(_schedule_id uuid, _date date, _window_start time without time zone, _window_end time without time zone) TO service_role;


--
-- Name: FUNCTION client_schedule_valid_on(_valid_from date, _valid_until date, _date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.client_schedule_valid_on(_valid_from date, _valid_until date, _date date) TO authenticated;
GRANT ALL ON FUNCTION public.client_schedule_valid_on(_valid_from date, _valid_until date, _date date) TO service_role;


--
-- Name: FUNCTION clients_open_debt(_client_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.clients_open_debt(_client_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.clients_open_debt(_client_ids uuid[]) TO authenticated;


--
-- Name: FUNCTION cobranca_assignees(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cobranca_assignees() FROM PUBLIC;
GRANT ALL ON FUNCTION public.cobranca_assignees() TO authenticated;


--
-- Name: FUNCTION cobranca_exceptions_watch(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cobranca_exceptions_watch() FROM PUBLIC;
GRANT ALL ON FUNCTION public.cobranca_exceptions_watch() TO authenticated;


--
-- Name: FUNCTION cobranca_followup_add_note(_followup_id uuid, _note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cobranca_followup_add_note(_followup_id uuid, _note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cobranca_followup_add_note(_followup_id uuid, _note text) TO authenticated;


--
-- Name: FUNCTION cobranca_followup_assign(_client_id uuid, _assignee uuid, _note text, _context text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cobranca_followup_assign(_client_id uuid, _assignee uuid, _note text, _context text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cobranca_followup_assign(_client_id uuid, _assignee uuid, _note text, _context text) TO authenticated;


--
-- Name: FUNCTION cobranca_followup_keep(_followup_id uuid, _note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cobranca_followup_keep(_followup_id uuid, _note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cobranca_followup_keep(_followup_id uuid, _note text) TO authenticated;


--
-- Name: FUNCTION cobranca_followups_auto_resolve(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cobranca_followups_auto_resolve() FROM PUBLIC;


--
-- Name: FUNCTION cobranca_followups_list(_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cobranca_followups_list(_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cobranca_followups_list(_status text) TO authenticated;


--
-- Name: FUNCTION create_substitute_schedule(p_original_schedule_id uuid, p_substitute_client_id uuid, p_valid_from date, p_valid_until date, p_notes text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_substitute_schedule(p_original_schedule_id uuid, p_substitute_client_id uuid, p_valid_from date, p_valid_until date, p_notes text) TO authenticated;


--
-- Name: FUNCTION debt_limit_add_exception(_client_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_add_exception(_client_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION debt_limit_alerts_list(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_alerts_list() TO authenticated;


--
-- Name: FUNCTION debt_limit_cancel_fixed_occurrence(_client_schedule_id uuid, _date date, _reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_cancel_fixed_occurrence(_client_schedule_id uuid, _date date, _reason text) TO authenticated;


--
-- Name: FUNCTION debt_limit_check_and_alert(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_check_and_alert(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION debt_limit_excepted_client_ids(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_excepted_client_ids() TO authenticated;


--
-- Name: FUNCTION debt_limit_is_client_excepted(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_is_client_excepted(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION debt_limit_notify_tomorrow_bookings(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_notify_tomorrow_bookings() TO authenticated;


--
-- Name: FUNCTION debt_limit_regularization_breakdown(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_regularization_breakdown(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION debt_limit_remove_exception(_exception_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_remove_exception(_exception_id uuid) TO authenticated;


--
-- Name: FUNCTION debt_limit_reopen_alert(_alert_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_reopen_alert(_alert_id uuid) TO authenticated;


--
-- Name: FUNCTION debt_limit_resolve_alert(_alert_id uuid, _note text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_resolve_alert(_alert_id uuid, _note text) TO authenticated;


--
-- Name: FUNCTION debt_limit_slot_price(_court smallint, _weekday smallint, _start time without time zone, _end time without time zone, _category_id uuid, _ref_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.debt_limit_slot_price(_court smallint, _weekday smallint, _start time without time zone, _end time without time zone, _category_id uuid, _ref_date date) TO authenticated;


--
-- Name: FUNCTION fixed_schedule_conflicts(_court integer, _date date, _start time without time zone, _end time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fixed_schedule_conflicts(_court integer, _date date, _start time without time zone, _end time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fixed_schedule_conflicts(_court integer, _date date, _start time without time zone, _end time without time zone) TO authenticated;
GRANT ALL ON FUNCTION public.fixed_schedule_conflicts(_court integer, _date date, _start time without time zone, _end time without time zone) TO service_role;


--
-- Name: FUNCTION fixed_waitlist_assign(_entry_id uuid, _teacher_id uuid, _valid_from date, _valid_months integer, _notes text, _court smallint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fixed_waitlist_assign(_entry_id uuid, _teacher_id uuid, _valid_from date, _valid_months integer, _notes text, _court smallint) TO authenticated;


--
-- Name: FUNCTION fixed_waitlist_free_matches(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fixed_waitlist_free_matches() TO authenticated;


--
-- Name: FUNCTION fixed_waitlist_join(_court smallint, _weekday smallint, _start time without time zone, _end time without time zone, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fixed_waitlist_join(_court smallint, _weekday smallint, _start time without time zone, _end time without time zone, _client_id uuid) TO authenticated;


--
-- Name: FUNCTION fixed_waitlist_leave(_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fixed_waitlist_leave(_id uuid) TO authenticated;


--
-- Name: FUNCTION fixed_waitlist_notify_expiring_schedules(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fixed_waitlist_notify_expiring_schedules() TO authenticated;


--
-- Name: FUNCTION fixed_waitlist_notify_free_slots(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fixed_waitlist_notify_free_slots() FROM PUBLIC;


--
-- Name: FUNCTION fixed_waitlist_position(_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fixed_waitlist_position(_id uuid) TO authenticated;


--
-- Name: FUNCTION fixed_waitlist_remove(_entry_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fixed_waitlist_remove(_entry_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;


--
-- Name: FUNCTION has_page_access(_user_id uuid, _page_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.has_page_access(_user_id uuid, _page_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_page_access(_user_id uuid, _page_key text) TO authenticated;


--
-- Name: FUNCTION has_role(_user_id uuid, _role public.app_role); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO authenticated;


--
-- Name: FUNCTION is_portal_client_of(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_portal_client_of(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION list_my_commission_sales(_from timestamp with time zone, _to timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_my_commission_sales(_from timestamp with time zone, _to timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_my_commission_sales(_from timestamp with time zone, _to timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION list_recepcionista_ids(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_recepcionista_ids() FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_recepcionista_ids() TO authenticated;


--
-- Name: FUNCTION log_audit_event(_entity text, _entity_id uuid, _action text, _details jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_audit_event(_entity text, _entity_id uuid, _action text, _details jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_audit_event(_entity text, _entity_id uuid, _action text, _details jsonb) TO authenticated;


--
-- Name: FUNCTION mark_charge_paid(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_charge_paid() FROM PUBLIC;


--
-- Name: FUNCTION move_booking_today(_booking_id uuid, _court smallint, _start_time time without time zone, _end_time time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.move_booking_today(_booking_id uuid, _court smallint, _start_time time without time zone, _end_time time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.move_booking_today(_booking_id uuid, _court smallint, _start_time time without time zone, _end_time time without time zone) TO authenticated;


--
-- Name: FUNCTION move_fixed_today(_schedule_id uuid, _date date, _court smallint, _start_time time without time zone, _end_time time without time zone, _booking_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.move_fixed_today(_schedule_id uuid, _date date, _court smallint, _start_time time without time zone, _end_time time without time zone, _booking_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.move_fixed_today(_schedule_id uuid, _date date, _court smallint, _start_time time without time zone, _end_time time without time zone, _booking_id uuid) TO authenticated;


--
-- Name: FUNCTION move_or_swap_booking(_booking_id uuid, _court smallint, _start_time time without time zone, _end_time time without time zone); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.move_or_swap_booking(_booking_id uuid, _court smallint, _start_time time without time zone, _end_time time without time zone) TO authenticated;


--
-- Name: FUNCTION open_debt_report(_from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.open_debt_report(_from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.open_debt_report(_from date, _to date) TO authenticated;


--
-- Name: FUNCTION payment_to_account_entry(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.payment_to_account_entry() FROM PUBLIC;


--
-- Name: FUNCTION payment_update_account_entry(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.payment_update_account_entry() FROM PUBLIC;


--
-- Name: FUNCTION portal_can_view_client(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_can_view_client(_client_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.portal_can_view_client(_client_id uuid) TO service_role;


--
-- Name: FUNCTION portal_cancel_booking(_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_cancel_booking(_booking_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.portal_cancel_booking(_booking_id uuid) TO service_role;


--
-- Name: FUNCTION portal_cancel_fixed_schedule(_schedule_id uuid, _date date, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_cancel_fixed_schedule(_schedule_id uuid, _date date, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_cancel_fixed_schedule(_schedule_id uuid, _date date, _reason text) TO authenticated;


--
-- Name: FUNCTION portal_create_paid_booking_hold(_court integer, _date date, _start time without time zone, _end time without time zone, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_create_paid_booking_hold(_court integer, _date date, _start time without time zone, _end time without time zone, _client_id uuid) TO authenticated;


--
-- Name: FUNCTION portal_get_category_names(_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_get_category_names(_ids uuid[]) TO authenticated;


--
-- Name: FUNCTION portal_join_court_waitlist(_date date, _start time without time zone, _end time without time zone, _source_booking_id uuid, _court_continuity text, _court smallint, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_join_court_waitlist(_date date, _start time without time zone, _end time without time zone, _source_booking_id uuid, _court_continuity text, _court smallint, _client_id uuid) TO authenticated;


--
-- Name: FUNCTION portal_leave_court_waitlist(_waitlist_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_leave_court_waitlist(_waitlist_id uuid) TO authenticated;


--
-- Name: FUNCTION portal_log_booking_failure(_client_id uuid, _booking_date date, _court integer, _start_hour integer, _stage text, _message text, _error_code text, _details jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_log_booking_failure(_client_id uuid, _booking_date date, _court integer, _start_hour integer, _stage text, _message text, _error_code text, _details jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_log_booking_failure(_client_id uuid, _booking_date date, _court integer, _start_hour integer, _stage text, _message text, _error_code text, _details jsonb) TO authenticated;


--
-- Name: FUNCTION portal_map_bookings(_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_map_bookings(_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_map_bookings(_date date) TO authenticated;


--
-- Name: FUNCTION portal_map_price_bands(_weekday integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_map_price_bands(_weekday integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_map_price_bands(_weekday integer) TO authenticated;
GRANT ALL ON FUNCTION public.portal_map_price_bands(_weekday integer) TO service_role;


--
-- Name: FUNCTION portal_map_schedule_exceptions(_date date, _weekday integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_map_schedule_exceptions(_date date, _weekday integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_map_schedule_exceptions(_date date, _weekday integer) TO authenticated;


--
-- Name: FUNCTION portal_map_schedules(_weekday integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_map_schedules(_weekday integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_map_schedules(_weekday integer) TO authenticated;


--
-- Name: FUNCTION portal_owned_client_ids(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_owned_client_ids(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_owned_client_ids(_user_id uuid) TO authenticated;


--
-- Name: FUNCTION portal_remove_profile_photo(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_remove_profile_photo(_client_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_remove_profile_photo(_client_id uuid) TO authenticated;


--
-- Name: FUNCTION portal_set_profile_photo(_client_id uuid, _photo_path text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_set_profile_photo(_client_id uuid, _photo_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_set_profile_photo(_client_id uuid, _photo_path text) TO authenticated;


--
-- Name: FUNCTION portal_slot_has_active_fixed_conflict(_court integer, _date date, _start time without time zone, _end time without time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_slot_has_active_fixed_conflict(_court integer, _date date, _start time without time zone, _end time without time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_slot_has_active_fixed_conflict(_court integer, _date date, _start time without time zone, _end time without time zone) TO authenticated;


--
-- Name: FUNCTION portal_update_profile(_client_id uuid, _birth_day smallint, _birth_month smallint, _tennis_class text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.portal_update_profile(_client_id uuid, _birth_day smallint, _birth_month smallint, _tennis_class text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.portal_update_profile(_client_id uuid, _birth_day smallint, _birth_month smallint, _tennis_class text) TO authenticated;


--
-- Name: FUNCTION portal_waitlist_position_by_id(_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_waitlist_position_by_id(_id uuid) TO authenticated;


--
-- Name: FUNCTION professor_create_direct_booking(_court smallint, _date date, _hour integer, _client_id uuid, _guest_name text, _for_self boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.professor_create_direct_booking(_court smallint, _date date, _hour integer, _client_id uuid, _guest_name text, _for_self boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.professor_create_direct_booking(_court smallint, _date date, _hour integer, _client_id uuid, _guest_name text, _for_self boolean) TO authenticated;


--
-- Name: FUNCTION professor_fixed_late_cancel_notice(_schedule_ids uuid[], _date date, _start time without time zone, _end time without time zone); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.professor_fixed_late_cancel_notice(_schedule_ids uuid[], _date date, _start time without time zone, _end time without time zone) TO authenticated;


--
-- Name: FUNCTION professor_late_cancel_resolve(_notification_id uuid, _outcome text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.professor_late_cancel_resolve(_notification_id uuid, _outcome text) TO authenticated;


--
-- Name: FUNCTION professor_partial_late_cancel_notice(_booking_id uuid, _start time without time zone, _end time without time zone); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.professor_partial_late_cancel_notice(_booking_id uuid, _start time without time zone, _end time without time zone) TO authenticated;


--
-- Name: FUNCTION professor_reactivate_booking(_booking_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.professor_reactivate_booking(_booking_id uuid) TO authenticated;


--
-- Name: FUNCTION professor_reactivate_fixed_occurrence(_schedule_id uuid, _occurrence_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.professor_reactivate_fixed_occurrence(_schedule_id uuid, _occurrence_date date) TO authenticated;


--
-- Name: FUNCTION reject_client_change_request(_request_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.reject_client_change_request(_request_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION request_court_booking_hold(_court integer, _date date, _start time without time zone, _end time without time zone, _label text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.request_court_booking_hold(_court integer, _date date, _start time without time zone, _end time without time zone, _label text) TO authenticated;


--
-- Name: FUNCTION resolve_portal_email_by_phone(_phone text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.resolve_portal_email_by_phone(_phone text) TO anon;
GRANT ALL ON FUNCTION public.resolve_portal_email_by_phone(_phone text) TO authenticated;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;


--
-- Name: FUNCTION staff_confirm_waitlist_booking(_waitlist_id uuid, _booking_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.staff_confirm_waitlist_booking(_waitlist_id uuid, _booking_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_create_client_for_pending_signup(_pending_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.staff_create_client_for_pending_signup(_pending_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_link_pending_client_signup(_pending_id uuid, _client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.staff_link_pending_client_signup(_pending_id uuid, _client_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_mark_waitlist_contacted(_waitlist_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.staff_mark_waitlist_contacted(_waitlist_id uuid) TO authenticated;


--
-- Name: FUNCTION staff_search_clients_for_signup_match(_query text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.staff_search_clients_for_signup_match(_query text) TO authenticated;


--
-- Name: FUNCTION staff_skip_waitlist_entry(_waitlist_id uuid, _reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.staff_skip_waitlist_entry(_waitlist_id uuid, _reason text) TO authenticated;


--
-- Name: FUNCTION swap_booking_courts(_booking_id_a uuid, _booking_id_b uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.swap_booking_courts(_booking_id_a uuid, _booking_id_b uuid) TO authenticated;


--
-- Name: FUNCTION teacher_agenda_range(_start_date date, _end_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.teacher_agenda_range(_start_date date, _end_date date) TO authenticated;


--
-- Name: FUNCTION teacher_map_bookings(_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.teacher_map_bookings(_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.teacher_map_bookings(_date date) TO authenticated;


--
-- Name: FUNCTION teacher_map_schedule_exceptions(_date date, _weekday integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.teacher_map_schedule_exceptions(_date date, _weekday integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.teacher_map_schedule_exceptions(_date date, _weekday integer) TO authenticated;


--
-- Name: FUNCTION teacher_map_schedules(_weekday integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.teacher_map_schedules(_weekday integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.teacher_map_schedules(_weekday integer) TO authenticated;


--
-- Name: FUNCTION teacher_map_schedules(_weekday integer, _date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.teacher_map_schedules(_weekday integer, _date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.teacher_map_schedules(_weekday integer, _date date) TO authenticated;


--
-- Name: FUNCTION validate_payment_court(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.validate_payment_court() FROM PUBLIC;


--
-- Name: FUNCTION visualizador_map_bookings(_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.visualizador_map_bookings(_date date) TO authenticated;


--
-- Name: FUNCTION visualizador_map_schedule_exceptions(_date date, _weekday integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.visualizador_map_schedule_exceptions(_date date, _weekday integer) TO authenticated;


--
-- Name: FUNCTION visualizador_map_schedules(_weekday integer, _date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.visualizador_map_schedules(_weekday integer, _date date) TO authenticated;


--
-- Name: FUNCTION waitlist_book_on_court(_waitlist_id uuid, _court integer, _teacher_id uuid, _teacher_set boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.waitlist_book_on_court(_waitlist_id uuid, _court integer, _teacher_id uuid, _teacher_set boolean) TO authenticated;


--
-- Name: FUNCTION waitlist_free_courts_for_entry(_waitlist_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.waitlist_free_courts_for_entry(_waitlist_id uuid) TO authenticated;


--
-- Name: FUNCTION waitlist_mark_and_book(_waitlist_id uuid, _teacher_id uuid, _teacher_set boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.waitlist_mark_and_book(_waitlist_id uuid, _teacher_id uuid, _teacher_set boolean) TO authenticated;


--
-- Name: TABLE court_waitlist; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.court_waitlist TO authenticated;
GRANT ALL ON TABLE public.court_waitlist TO service_role;


--
-- Name: FUNCTION waitlist_resolve_teacher(_w public.court_waitlist, _teacher_id uuid, _teacher_set boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.waitlist_resolve_teacher(_w public.court_waitlist, _teacher_id uuid, _teacher_set boolean) FROM PUBLIC;


--
-- Name: TABLE app_notifications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.app_notifications TO authenticated;
GRANT ALL ON TABLE public.app_notifications TO service_role;


--
-- Name: TABLE app_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.app_settings TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.app_settings TO authenticated;
GRANT ALL ON TABLE public.app_settings TO service_role;


--
-- Name: TABLE booking_confirmations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.booking_confirmations TO authenticated;
GRANT ALL ON TABLE public.booking_confirmations TO service_role;


--
-- Name: TABLE cash_closings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.cash_closings TO authenticated;
GRANT ALL ON TABLE public.cash_closings TO service_role;


--
-- Name: TABLE cleaning_purchases; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.cleaning_purchases TO authenticated;
GRANT ALL ON TABLE public.cleaning_purchases TO service_role;


--
-- Name: TABLE client_portal_users; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.client_portal_users TO authenticated;
GRANT ALL ON TABLE public.client_portal_users TO service_role;


--
-- Name: TABLE client_schedule_attendance; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.client_schedule_attendance TO authenticated;
GRANT ALL ON TABLE public.client_schedule_attendance TO service_role;


--
-- Name: TABLE client_schedule_day_notes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.client_schedule_day_notes TO authenticated;
GRANT ALL ON TABLE public.client_schedule_day_notes TO service_role;


--
-- Name: TABLE client_schedule_exceptions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.client_schedule_exceptions TO authenticated;
GRANT ALL ON TABLE public.client_schedule_exceptions TO service_role;


--
-- Name: TABLE client_schedules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.client_schedules TO authenticated;
GRANT ALL ON TABLE public.client_schedules TO service_role;


--
-- Name: TABLE client_teacher_link_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.client_teacher_link_requests TO authenticated;
GRANT ALL ON TABLE public.client_teacher_link_requests TO service_role;


--
-- Name: TABLE client_teachers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.client_teachers TO authenticated;
GRANT ALL ON TABLE public.client_teachers TO service_role;


--
-- Name: TABLE clients; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.clients TO authenticated;


--
-- Name: TABLE court_availability_overrides; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.court_availability_overrides TO authenticated;
GRANT ALL ON TABLE public.court_availability_overrides TO service_role;


--
-- Name: TABLE court_booking_participants; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.court_booking_participants TO authenticated;
GRANT ALL ON TABLE public.court_booking_participants TO service_role;


--
-- Name: TABLE court_bookings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.court_bookings TO authenticated;
GRANT ALL ON TABLE public.court_bookings TO service_role;


--
-- Name: TABLE debt_limit_alert_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.debt_limit_alert_events TO authenticated;
GRANT ALL ON TABLE public.debt_limit_alert_events TO service_role;


--
-- Name: TABLE debt_limit_alerts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.debt_limit_alerts TO authenticated;
GRANT ALL ON TABLE public.debt_limit_alerts TO service_role;


--
-- Name: TABLE debt_limit_exceptions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.debt_limit_exceptions TO authenticated;
GRANT ALL ON TABLE public.debt_limit_exceptions TO service_role;


--
-- Name: TABLE debt_limit_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,UPDATE ON TABLE public.debt_limit_settings TO authenticated;
GRANT ALL ON TABLE public.debt_limit_settings TO service_role;


--
-- Name: TABLE fixed_court_waitlist; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.fixed_court_waitlist TO authenticated;
GRANT ALL ON TABLE public.fixed_court_waitlist TO service_role;


--
-- Name: TABLE fixed_waitlist_court_hours; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.fixed_waitlist_court_hours TO authenticated;
GRANT ALL ON TABLE public.fixed_waitlist_court_hours TO service_role;


--
-- Name: TABLE fixed_waitlist_court_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.fixed_waitlist_court_settings TO authenticated;
GRANT ALL ON TABLE public.fixed_waitlist_court_settings TO service_role;


--
-- Name: TABLE neurochat_message_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.neurochat_message_logs TO authenticated;
GRANT ALL ON TABLE public.neurochat_message_logs TO service_role;


--
-- Name: TABLE pending_client_signups; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.pending_client_signups TO authenticated;
GRANT ALL ON TABLE public.pending_client_signups TO service_role;


--
-- Name: TABLE pending_signups; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,DELETE ON TABLE public.pending_signups TO authenticated;
GRANT ALL ON TABLE public.pending_signups TO service_role;


--
-- Name: TABLE portal_booking_failures; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.portal_booking_failures TO authenticated;


--
-- Name: TABLE portal_signup_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.portal_signup_tokens TO authenticated;
GRANT ALL ON TABLE public.portal_signup_tokens TO service_role;


--
-- Name: TABLE price_table; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.price_table TO authenticated;
GRANT ALL ON TABLE public.price_table TO service_role;


--
-- Name: TABLE racket_loans; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.racket_loans TO authenticated;
GRANT ALL ON TABLE public.racket_loans TO service_role;


--
-- Name: TABLE stock_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stock_items TO authenticated;
GRANT ALL ON TABLE public.stock_items TO service_role;


--
-- Name: TABLE stock_movements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stock_movements TO authenticated;
GRANT ALL ON TABLE public.stock_movements TO service_role;


--
-- Name: TABLE teacher_signup_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.teacher_signup_tokens TO authenticated;
GRANT ALL ON TABLE public.teacher_signup_tokens TO service_role;


--
-- Name: TABLE teachers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.teachers TO authenticated;
GRANT ALL ON TABLE public.teachers TO service_role;


--
-- Name: TABLE waitlist_acknowledgements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.waitlist_acknowledgements TO authenticated;
GRANT ALL ON TABLE public.waitlist_acknowledgements TO service_role;


--
-- Name: TABLE work_task_comments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.work_task_comments TO authenticated;
GRANT ALL ON TABLE public.work_task_comments TO service_role;


--
-- PostgreSQL database dump complete
--




-- =====================================================================
-- Stadium Rackets: regras de cancelamento tardio (24h na quadra de tênis)
-- =====================================================================
SET search_path = public, extensions;
--
-- Stadium Rackets — cancelamento tardio
--
-- • Quadra de TÊNIS (quadra 1): é a única quadra de tênis, então a locação
--   precisa ser cancelada com pelo menos 24h de antecedência (dá tempo de
--   alugar o horário pra outra pessoa). Vale para QUALQUER cancelamento de
--   locação com cliente — recepção, portal do cliente ou professor.
-- • Quadras de PICKLEBALL: mantém a regra do professor (3h antes).
--
-- Cancelou depois do prazo → a recepção e a diretoria recebem o aviso
-- "Cancelamento com menos de Xh" (pop-up com "Lançar no caixa" / "Não
-- cobrar"), igual ao fluxo que já existia para o professor.
--

CREATE OR REPLACE FUNCTION public.court_cancel_window_hours(_court integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE WHEN _court = 1 THEN 24 ELSE 3 END
$$;

CREATE OR REPLACE FUNCTION public.court_cancel_is_late(_court integer, _date date, _start time without time zone, _cancelled_at timestamp with time zone) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT date_trunc('minute', _cancelled_at)
         > ((_date::text || ' ' || _start::text)::timestamp AT TIME ZONE 'America/Recife')
           - make_interval(hours => public.court_cancel_window_hours(_court));
$$;

-- A regra vale pra todo mundo na quadra de tênis; nas demais, só pro professor.
CREATE OR REPLACE FUNCTION public.court_late_cancel_applies(_court integer, _user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT _court = 1 OR public.has_role(_user, 'professor'::public.app_role)
$$;

-- Nome de quem cancelou, para o texto do aviso.
CREATE OR REPLACE FUNCTION public._canceller_label(_user uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT name FROM public.teachers WHERE user_id = _user LIMIT 1),
    CASE WHEN EXISTS (SELECT 1 FROM public.client_portal_users WHERE user_id = _user)
              AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user)
         THEN 'O cliente (pelo portal)' END,
    (SELECT NULLIF(full_name, '') FROM public.profiles WHERE id = _user),
    'Alguém'
  )
$$;

-- Mantida por compatibilidade (regra de 3h do professor).
CREATE OR REPLACE FUNCTION public.professor_cancel_is_late(_date date, _start time without time zone, _cancelled_at timestamp with time zone) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT public.court_cancel_is_late(NULL, _date, _start, _cancelled_at);
$$;

CREATE OR REPLACE FUNCTION public._notify_professor_late_cancel(_event_key text, _client_id uuid, _teacher_name text, _court integer, _date date, _start time without time zone, _end time without time zone, _cancelled_at timestamp with time zone, _is_fixed boolean, _booking_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _client_name text;
  _staff record;
  _hours integer := public.court_cancel_window_hours(_court);
  _title text;
  _body text;
BEGIN
  SELECT full_name INTO _client_name FROM public.clients WHERE id = _client_id;
  _title := 'Cancelamento com menos de ' || _hours || 'h';

  _body := COALESCE(_teacher_name, 'Alguém') || ' cancelou '
    || CASE WHEN _is_fixed THEN 'o horário fixo' ELSE 'a locação' END
    || ' de ' || COALESCE(_client_name, 'cliente')
    || ' — ' || to_char(_date, 'DD/MM') || ' às ' || to_char(_start, 'HH24:MI')
    || '–' || to_char(_end, 'HH24:MI')
    || COALESCE(' (' || public._court_short(_court) || ')', '')
    || ', às ' || to_char(_cancelled_at AT TIME ZONE 'America/Recife', 'DD/MM HH24:MI')
    || CASE WHEN _court = 1
         THEN '. Quadra de tênis: o cancelamento sem custo é até 24h antes — a quadra deve ser lançada no caixa (débito na conta do cliente).'
         ELSE '. Pela regra (até ' || _hours || 'h antes), a quadra deve ser lançada como débito na conta do cliente.'
       END;

  FOR _staff IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role IN ('recepcionista'::public.app_role, 'diretoria'::public.app_role)
  LOOP
    INSERT INTO public.app_notifications
      (kind, client_id, user_id, title, body, requires_ack, metadata, dedup_key)
    VALUES (
      'professor_late_cancel',
      _client_id,
      _staff.user_id,
      _title,
      _body,
      true,
      jsonb_build_object(
        'event_key', _event_key,
        'client_id', _client_id,
        'client_name', _client_name,
        'teacher_name', _teacher_name,
        'court', _court,
        'date', _date,
        'start_time', _start::text,
        'end_time', _end::text,
        'cancelled_at', _cancelled_at,
        'is_fixed', _is_fixed,
        'booking_id', _booking_id,
        'window_hours', _hours
      ),
      'professor_late_cancel|' || _event_key || '|' || _staff.user_id::text
    )
    ON CONFLICT (dedup_key) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._notify_professor_late_cancel(text, uuid, text, integer, date, time without time zone, time without time zone, timestamp with time zone, boolean, uuid) FROM PUBLIC;

-- Trigger de cancelamento de locação (court_bookings): aviso ao cliente quando
-- é o professor que cancela, e aviso de cobrança quando passou do prazo.
CREATE OR REPLACE FUNCTION public.court_bookings_professor_cancel_fee() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _client_name text;
  _who text;
  _is_prof boolean;
BEGIN
  IF NEW.cancelled_at IS NULL OR OLD.cancelled_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Pré-reserva (hold) que expirou não é cancelamento de verdade.
  IF NEW.hold_expires_at IS NOT NULL AND NEW.cancelled_by IS NULL THEN
    RETURN NEW;
  END IF;

  _is_prof := NEW.cancelled_by IS NOT NULL
              AND public.has_role(NEW.cancelled_by, 'professor'::public.app_role);
  _who := public._canceller_label(NEW.cancelled_by);

  IF _is_prof THEN
    SELECT full_name INTO _client_name FROM public.clients WHERE id = NEW.client_id;
    -- Aviso ao cliente (mantido como era).
    INSERT INTO public.app_notifications(kind, client_id, title, body)
    VALUES (
      'professor_cancel',
      NEW.client_id,
      'Aula cancelada pelo professor',
      _who || ' cancelou aula de '
        || COALESCE(_client_name, 'cliente') || ' em '
        || to_char(NEW.booking_date, 'DD/MM') || ' às '
        || to_char(NEW.start_time, 'HH24:MI')
        || ' (' || public._court_short(NEW.court) || ')'
    );
  END IF;

  IF (NEW.court = 1 OR _is_prof)
     AND public.court_cancel_is_late(NEW.court, NEW.booking_date, NEW.start_time, NEW.cancelled_at) THEN
    PERFORM public._notify_professor_late_cancel(
      'booking:' || NEW.id::text,
      NEW.client_id, _who, NEW.court,
      NEW.booking_date, NEW.start_time, NEW.end_time,
      NEW.cancelled_at, false, NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.professor_partial_late_cancel_notice(_booking_id uuid, _start time without time zone, _end time without time zone) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _b public.court_bookings%ROWTYPE;
BEGIN
  SELECT * INTO _b FROM public.court_bookings WHERE id = _booking_id;
  IF _b.id IS NULL OR _b.client_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT public.court_late_cancel_applies(_b.court, auth.uid()) THEN
    RETURN false;
  END IF;
  IF NOT public.court_cancel_is_late(_b.court, _b.booking_date, _start, now()) THEN
    RETURN false;
  END IF;
  -- O trecho precisa estar livre de locação ativa desse cliente nessa quadra.
  IF EXISTS (
    SELECT 1 FROM public.court_bookings x
    WHERE x.booking_date = _b.booking_date
      AND x.court = _b.court
      AND x.client_id = _b.client_id
      AND x.cancelled_at IS NULL
      AND x.start_time < _end
      AND x.end_time > _start
  ) THEN
    RETURN false;
  END IF;

  PERFORM public._notify_professor_late_cancel(
    'partial:' || _b.id::text || ':' || _start::text,
    _b.client_id, public._canceller_label(auth.uid()), _b.court,
    _b.booking_date, _start, _end, now(), false, _b.id
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.professor_fixed_late_cancel_notice(_schedule_ids uuid[], _date date, _start time without time zone, _end time without time zone) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _s record;
  _count integer := 0;
  _who text := public._canceller_label(auth.uid());
BEGIN
  FOR _s IN
    SELECT cs.id, cs.client_id, cs.court
    FROM public.client_schedules cs
    WHERE cs.id = ANY (_schedule_ids)
      AND cs.client_id IS NOT NULL
      AND public.court_late_cancel_applies(cs.court, auth.uid())
      AND public.court_cancel_is_late(cs.court, _date, _start, now())
      AND EXISTS (
        SELECT 1 FROM public.client_schedule_exceptions e
        WHERE e.client_schedule_id = cs.id
          AND e.exception_date = _date
          AND e.created_by = auth.uid()
          AND e.created_at > now() - interval '5 minutes'
      )
  LOOP
    PERFORM public._notify_professor_late_cancel(
      'fixed:' || _s.id::text || ':' || _date::text || ':' || _start::text,
      _s.client_id, _who, _s.court,
      _date, _start, _end, now(), true, NULL
    );
    _count := _count + 1;
  END LOOP;

  RETURN _count;
END;
$$;

-- Cliente cancelando o próprio horário fixo pelo portal: na quadra de tênis
-- com menos de 24h, a recepção também recebe o aviso de cobrança.
CREATE OR REPLACE FUNCTION public.portal_cancel_fixed_schedule(_schedule_id uuid, _date date, _reason text DEFAULT 'Cancelado pelo cliente'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _cs public.client_schedules%ROWTYPE;
  _exc_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO _cs FROM public.client_schedules WHERE id = _schedule_id;
  IF _cs.client_id IS NULL THEN
    RAISE EXCEPTION 'schedule not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.portal_owned_client_ids(auth.uid()) p
    WHERE p.client_id = _cs.client_id
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Remove any partial exceptions for this day and insert a full-day cancel
  DELETE FROM public.client_schedule_exceptions
  WHERE client_schedule_id = _schedule_id AND exception_date = _date;

  INSERT INTO public.client_schedule_exceptions (
    client_schedule_id, exception_date, reason, created_by, start_time, end_time
  ) VALUES (
    _schedule_id, _date, _reason, auth.uid(), NULL, NULL
  )
  RETURNING id INTO _exc_id;

  IF _cs.court = 1 AND public.court_cancel_is_late(_cs.court, _date, _cs.start_time, now()) THEN
    PERFORM public._notify_professor_late_cancel(
      'fixed:' || _cs.id::text || ':' || _date::text || ':' || _cs.start_time::text,
      _cs.client_id, 'O cliente (pelo portal)', _cs.court,
      _date, _cs.start_time, _cs.end_time, now(), true, NULL
    );
  END IF;

  RETURN _exc_id;
END;
$$;

GRANT ALL ON FUNCTION public.court_cancel_window_hours(integer) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.court_cancel_is_late(integer, date, time without time zone, timestamp with time zone) TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public._court_short(integer) TO anon, authenticated, service_role;

--
-- RLS: a política "teacher_select_own_clients" (clients) lia court_bookings,
-- e as políticas de court_bookings leem clients — ciclo que o Postgres
-- recusa ("infinite recursion detected in policy"). A lista de clientes do
-- professor passa a vir de uma função SECURITY DEFINER (sem RLS por dentro),
-- quebrando o ciclo sem mudar quem enxerga o quê.
--
CREATE OR REPLACE FUNCTION public.teacher_visible_client_ids(_uid uuid) RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT cs.client_id
    FROM public.client_schedules cs JOIN public.teachers t ON t.id = cs.teacher_id
   WHERE t.user_id = _uid AND cs.client_id IS NOT NULL
  UNION
  SELECT cb.client_id
    FROM public.court_bookings cb JOIN public.teachers t ON t.id = cb.teacher_id
   WHERE t.user_id = _uid AND cb.client_id IS NOT NULL
  UNION
  SELECT c.id
    FROM public.clients c JOIN public.teachers t ON t.id = c.teacher_id
   WHERE t.user_id = _uid
  UNION
  SELECT ct.client_id
    FROM public.client_teachers ct JOIN public.teachers t ON t.id = ct.teacher_id
   WHERE t.user_id = _uid
$$;
REVOKE ALL ON FUNCTION public.teacher_visible_client_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_visible_client_ids(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS teacher_select_own_clients ON public.clients;
CREATE POLICY teacher_select_own_clients ON public.clients FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'professor'::public.app_role)
    AND id IN (SELECT public.teacher_visible_client_ids(auth.uid()))
  );


-- =====================================================================
-- Login → perfil (auth.users)
-- =====================================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================================
-- Realtime (mapa de quadras, caixa, avisos ao vivo)
-- =====================================================================
DO $rt$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY['clients', 'monthly_charges', 'payments', 'account_entries', 'audit_logs', 'whatsapp_notifications', 'client_schedules', 'app_notifications', 'court_bookings', 'client_schedule_exceptions', 'client_schedule_attendance', 'court_booking_participants', 'court_waitlist', 'court_availability_overrides', 'waitlist_acknowledgements', 'debt_limit_alerts', 'client_schedule_day_notes']::text[] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$rt$;
ALTER TABLE public.court_bookings REPLICA IDENTITY FULL;
ALTER TABLE public.client_schedule_exceptions REPLICA IDENTITY FULL;

-- =====================================================================
-- Storage: comprovantes de pagamento e fotos de clientes
-- =====================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-receipts', 'payment-receipts', false),
       ('client-profile-photos', 'client-profile-photos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "receipts_storage_insert" ON storage.objects;
CREATE POLICY "receipts_storage_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-receipts' AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));
DROP POLICY IF EXISTS "receipts_storage_delete" ON storage.objects;
CREATE POLICY "receipts_storage_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payment-receipts' AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));
DROP POLICY IF EXISTS "receipts_storage_update" ON storage.objects;
CREATE POLICY "receipts_storage_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'payment-receipts' AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)))
  WITH CHECK (bucket_id = 'payment-receipts' AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));
DROP POLICY IF EXISTS "Staff can read payment receipts" ON storage.objects;
CREATE POLICY "Staff can read payment receipts" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-receipts' AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'recepcionista'::public.app_role) OR public.has_role(auth.uid(), 'diretoria'::public.app_role)));
DROP POLICY IF EXISTS "Portal users can read own receipts" ON storage.objects;
CREATE POLICY "Portal users can read own receipts" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'payment-receipts' AND EXISTS (
    SELECT 1 FROM public.payment_receipts pr
    WHERE pr.file_path = objects.name AND pr.client_id IS NOT NULL AND public.portal_can_view_client(pr.client_id)));
DROP POLICY IF EXISTS "client photos: read" ON storage.objects;
CREATE POLICY "client photos: read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'client-profile-photos' AND public.can_access_client_photo(name));
DROP POLICY IF EXISTS "client photos: insert" ON storage.objects;
CREATE POLICY "client photos: insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-profile-photos' AND public.can_access_client_photo(name));
DROP POLICY IF EXISTS "client photos: update" ON storage.objects;
CREATE POLICY "client photos: update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'client-profile-photos' AND public.can_access_client_photo(name))
  WITH CHECK (bucket_id = 'client-profile-photos' AND public.can_access_client_photo(name));
DROP POLICY IF EXISTS "client photos: delete" ON storage.objects;
CREATE POLICY "client photos: delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'client-profile-photos' AND public.can_access_client_photo(name));

-- =====================================================================
-- Rotinas agendadas (pg_cron)
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $cron$
DECLARE j text;
BEGIN
  FOREACH j IN ARRAY ARRAY[
    'debt_limit_notify_tomorrow_bookings', 'fixed_waitlist_notify_expiring_schedules',
    'expire_court_booking_holds', 'portal_booking_failures_cleanup',
    'cobranca_followups_auto_resolve', 'fixed_waitlist_notify_free_slots'
  ] LOOP
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = j;
  END LOOP;
END
$cron$;
SELECT cron.schedule('debt_limit_notify_tomorrow_bookings', '0 12 * * *', $$ SELECT public.debt_limit_notify_tomorrow_bookings(); $$);
SELECT cron.schedule('fixed_waitlist_notify_expiring_schedules', '0 12 * * *', $$ SELECT public.fixed_waitlist_notify_expiring_schedules(); $$);
SELECT cron.schedule('expire_court_booking_holds', '* * * * *', $$
  UPDATE public.court_bookings SET cancelled_at = now()
  WHERE hold_expires_at IS NOT NULL AND hold_expires_at <= now() AND cancelled_at IS NULL;
$$);
SELECT cron.schedule('portal_booking_failures_cleanup', '10 3 * * *', $$ DELETE FROM public.portal_booking_failures WHERE created_at < now() - INTERVAL '90 days'; $$);
SELECT cron.schedule('cobranca_followups_auto_resolve', '*/10 * * * *', $$ SELECT public.cobranca_followups_auto_resolve(); $$);
SELECT cron.schedule('fixed_waitlist_notify_free_slots', '0 12 * * *', $$ SELECT public.fixed_waitlist_notify_free_slots(); $$);

-- =====================================================================
-- Dados iniciais (configuração)
-- =====================================================================
INSERT INTO public.client_categories (name, default_amount, active) VALUES
  ('Avulso', 0, true),
  ('Mensalista', 0, true),
  ('Débito avulso', 0, true),
  ('Pendência avulsa', 0, true),
  ('Saldo anterior', 0, true),
  ('Estorno', 0, true),
  ('Crédito Gympass', 0, true),
  ('Aula (professor)', 0, true),
  ('Locação de professor', 0, true),
  ('Ranking Masculino', 0, true),
  ('Ranking Feminino', 0, true),
  ('Manutenção', 0, true),
  ('Grip', 0, true),
  ('Terno de bola', 0, true)
ON CONFLICT DO NOTHING;

INSERT INTO public.stock_items (name, current_quantity) VALUES
  ('Terno de bola', 0),
  ('Grip', 0)
ON CONFLICT DO NOTHING;

INSERT INTO public.app_settings (key, value) VALUES
  ('whatsapp_reservations_number', '')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.debt_limit_settings (id, limit_amount, rule_start_date)
VALUES (true, 210, CURRENT_DATE)
ON CONFLICT (id) DO NOTHING;
