-- =====================================================================
-- Move City | PIN Code ahead of Address (previous migration put
-- Address first). Now the pairing reads: City | PIN Code, then
-- Address on its own full-width line below, then School | Board,
-- then Class | Terms Accepted.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.admin_get_overview()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'success', true,

    'verificationValues', jsonb_build_array('Verified', 'Rejected', 'Pending for Verification'),

    'students', jsonb_build_object(
      'headers', jsonb_build_array(
        'Timestamp', 'Student ID', 'Parents Name', 'Student Name', 'Phone',
        'WhatsApp', 'Email', 'Gender', 'City', 'PIN Code', 'Address',
        'School', 'Board', 'Class', 'Terms Accepted'),
      'readOnly', jsonb_build_array('Student ID', 'Timestamp', 'Terms Accepted'),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'rowNumber', rn,
          'id',        student_id,
          'values', jsonb_build_object(
            'Timestamp',      public._adm_ts(created_at),
            'Student ID',     student_id,
            'Parents Name',   coalesce(parents_name, ''),
            'Student Name',   coalesce(student_name, ''),
            'Phone',          coalesce(phone, ''),
            'WhatsApp',       coalesce(whatsapp, ''),
            'Email',          coalesce(email, ''),
            'Gender',         coalesce(gender, ''),
            'City',           coalesce(city, ''),
            'Address',        coalesce(address, ''),
            'PIN Code',       coalesce(pin_code, ''),
            'Terms Accepted', upper(terms_accepted::text),
            'School',         coalesce(school, ''),
            'Class',          coalesce(class_name, ''),
            'Board',          coalesce(board, '')
          )
        ) order by rn)
        from (select *, (row_number() over (order by created_at, student_id))::int + 1 as rn
              from public.students) s
      ), '[]'::jsonb)
    ),

    'tutors', jsonb_build_object(
      'headers', jsonb_build_array(
        'Registered At', 'Tutor ID', 'E-mail Address', 'Mobile Number',
        'WhatsApp Number', 'Register As', 'Full Name', 'Birth Date', 'Gender',
        'Languages Known', 'Identity Proof', 'Profile Image',
        'Class 12th - Stream', 'Class 12th - Passing Year',
        'Class 12th Percentage', 'Class 12th CGPA', 'Class 12th - Board',
        'Graduation - Course', 'Graduation - Subject',
        'Graduation - College/University', 'Graduation - Passing Year',
        'Graduation - Percentage', 'Post Graduation Subject',
        'Post Graduation College/University', 'Post Graduation Passing Year',
        'Post Graduation Percentage', 'Special Courses',
        'Special Child Disability', 'Experience (In Years)',
        'Classes You Teach', 'Subject You Teach', 'Boards You Teach',
        'Teaching Location', 'City', 'Present Address', 'Pin Code',
        'Terms Accepted', 'Email Verified', 'Verification Status'),
      'readOnly', jsonb_build_array(
        'Tutor ID', 'Registered At', 'Email Verified', 'Terms Accepted',
        'Identity Proof', 'Profile Image'),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'rowNumber', rn,
          'id',        tutor_id,
          'values', jsonb_build_object(
            'Registered At',   public._adm_ts(registered_at),
            'Tutor ID',        tutor_id,
            'E-mail Address',  coalesce(email, ''),
            'Mobile Number',   coalesce(mobile_number, ''),
            'WhatsApp Number', coalesce(whatsapp_number, ''),
            'Register As',     coalesce(register_as, ''),
            'Full Name',       coalesce(full_name, ''),
            'Birth Date',      coalesce(to_char(birth_date, 'DD/MM/YYYY'), ''),
            'Gender',          coalesce(gender, ''),
            'Languages Known', coalesce(languages_known, ''),
            -- storage paths; the admin Edge Function turns them into
            -- temporary links before they reach the browser
            'Identity Proof',  coalesce(identity_proof, ''),
            'Profile Image',   coalesce(profile_image, ''),
            'Class 12th - Stream',             coalesce(class12_stream, ''),
            'Class 12th - Passing Year',       coalesce(class12_passing_year::text, ''),
            'Class 12th Percentage',           public._adm_show(class12_percentage),
            'Class 12th CGPA',                 public._adm_show(class12_cgpa),
            'Class 12th - Board',              coalesce(class12_board, ''),
            'Graduation - Course',             coalesce(graduation_course, ''),
            'Graduation - Subject',            coalesce(graduation_subject, ''),
            'Graduation - College/University', coalesce(graduation_college, ''),
            'Graduation - Passing Year',       coalesce(graduation_passing_year::text, ''),
            'Graduation - Percentage',         public._adm_show(graduation_percentage),
            'Post Graduation Subject',         coalesce(pg_subject, ''),
            'Post Graduation College/University', coalesce(pg_college, ''),
            'Post Graduation Passing Year',    coalesce(pg_passing_year::text, ''),
            'Post Graduation Percentage',      public._adm_show(pg_percentage),
            'Special Courses',                 coalesce(special_courses, ''),
            'Special Child Disability',        coalesce(special_child_disability, ''),
            'Experience (In Years)',           public._adm_show(experience_years),
            'Classes You Teach',               coalesce(classes_you_teach, ''),
            'Subject You Teach',               coalesce(subjects_you_teach, ''),
            'Boards You Teach',                coalesce(boards_you_teach, ''),
            'Teaching Location',               coalesce(teaching_location, ''),
            'City',                            coalesce(city, ''),
            'Present Address',                 coalesce(present_address, ''),
            'Pin Code',                        coalesce(pin_code, ''),
            'Terms Accepted',                  upper(terms_accepted::text),
            'Email Verified',                  upper(email_verified::text),
            'Verification Status',             coalesce(verification_status, '')
          )
        ) order by rn)
        from (select *, (row_number() over (order by registered_at, tutor_id))::int + 1 as rn
              from public.tutors) u
      ), '[]'::jsonb)
    ),

    'demos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rowNumber',       rn,
        'demoId',          demo_id,
        'studentId',       student_id,
        'subject',         coalesce(subject, ''),
        'medium',          coalesce(medium, ''),
        'preferredTutor',  coalesce(preferred_tutor, ''),
        'preferredTiming', coalesce(preferred_timing, ''),
        'postedOn',        public._adm_ts(posted_at),
        'tutorId',         coalesce(tutor_id, ''),
        'mobile',          coalesce(mobile_number, ''),
        'mobileKey',       right(regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g'), 10),
        'hasTutor',        tutor_id is not null,
        'demoDate',        coalesce(to_char(demo_date, 'DD/MM/YYYY'), ''),
        'demoTime',        coalesce(to_char(demo_time, 'HH12:MI AM'), ''),
        'price',           coalesce(price, ''),
        'duration',        coalesce(duration, ''),
        'percentage',      coalesce(percentage, ''),
        'parentAccepted',  coalesce(parent_accepted, false),
        'parentRejected',  coalesce(parent_rejected, false),
        'tutorAccepted',   coalesce(tutor_accepted, false),
        'tutorRejected',   coalesce(tutor_rejected, false),
        'classesCompleted', coalesce(classes_completed, false),
        'terminated',      terminated
      ) order by rn)
      from (
        select t.demo_id, t.student_id, t.subject, t.medium, t.preferred_tutor,
               t.preferred_timing, t.posted_at, t.terminated,
               a.tutor_id, u.mobile_number, a.demo_date, a.demo_time,
               a.price, a.duration, a.percentage,
               a.parent_accepted, a.parent_rejected, a.tutor_accepted,
               a.tutor_rejected, a.classes_completed,
               (row_number() over (order by t.posted_at, t.demo_id,
                                   a.applied_at nulls first, a.id))::int + 1 as rn
        from public.tuitions t
        left join public.applications a on a.demo_id = t.demo_id
        left join public.tutors u on u.tutor_id = a.tutor_id
      ) d
    ), '[]'::jsonb)
  )
$function$;
