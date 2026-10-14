# WhatsApp message templates (Meta approval)

Create each one in **WhatsApp Manager -> Message templates -> Create template**.

For every template use:

- **Category:** Utility
- **Language:** English
- **Name:** exactly as written below (lowercase, underscores - the code will use this name)
- **Header:** none
- **Footer:** `Urban Tutor Site` (optional)
- **Button:** one **Visit website** button, text `Open My Profile`, type **Dynamic**,
  URL `https://kurafatengineer.github.io/urbantutorsite/{{1}}`, sample value `studentprofile.html`
  (the code fills it with `studentprofile.html` or `tutorprofile.html`).
  The class-check template has a **Quick reply** button `Yes, I took the class` instead (plus the website button).

The `{{1}}`, `{{2}}` ... in the body are variables. Their ORDER must not change later (the code sends them in that order).
Samples are what Meta shows to the reviewer - put them in the "sample content" fields.

| # | Name | To | Body | Samples ({{1}}, {{2}}, ...) |
|---|------|----|------|-----------------------------|
| 1 | ut_tuition_posted | student | Hi {{1}}, your tuition request for {{2}} has been posted. Verified tutors can now apply, and we will let you know as soon as one does. | Rahul Kumar; Mathematics |
| 2 | ut_tutor_applied | student | Hi {{1}}, {{2}} has applied for your {{3}} tuition (Demo ID {{4}}). Open your profile to review the tutor. | Rahul Kumar; Atish Mathur; Mathematics; DID20260101 |
| 3 | ut_demo_scheduled | student, tutor | Hi {{1}}, a demo class for the {{2}} tuition (Demo ID {{3}}) is scheduled with {{4}} on {{5}} at {{6}}. Please be ready a few minutes early. After the demo, open your profile to accept or reject. | Rahul Kumar; Mathematics; DID20260101; Atish Mathur; 15 October 2026; 5:00 PM |
| 4 | ut_tutor_accepted | student | Good news {{1}}! {{2}} has accepted your {{3}} tuition (Demo ID {{4}}). Please confirm from your profile to get started. | Rahul Kumar; Atish Mathur; Mathematics; DID20260101 |
| 5 | ut_tutor_declined | student | Hi {{1}}, {{2}} is not able to take your {{3}} tuition (Demo ID {{4}}). Your request is still open, so other tutors can apply. | Rahul Kumar; Atish Mathur; Mathematics; DID20260101 |
| 6 | ut_parent_accepted | tutor | Hi {{1}}, the parent of {{2}} has accepted you for the {{3}} tuition (Demo ID {{4}}). Please confirm from your profile. | Atish Mathur; Rahul Kumar; Mathematics; DID20260101 |
| 7 | ut_parent_declined | tutor | Hi {{1}}, the parent of {{2}} has chosen not to go ahead for the {{3}} tuition (Demo ID {{4}}). You can apply for other tuitions anytime. | Atish Mathur; Rahul Kumar; Mathematics; DID20260101 |
| 8 | ut_tuition_confirmed | student, tutor | Hi {{1}}, you and {{2}} have both accepted the {{3}} tuition (Demo ID {{4}}). Our agency will contact you shortly with the class and payment details. | Rahul Kumar; Atish Mathur; Mathematics; DID20260101 |
| 9 | ut_agreement_ready | student, tutor | Hi {{1}}, the class agreement for the {{2}} tuition (Demo ID {{3}}) is ready. Open your profile to see the class days, time and fees. | Rahul Kumar; Mathematics; DID20260101 |
| 10 | ut_class_reminder | student, tutor | Hi {{1}}, you have a {{2}} class today at {{3}} with {{4}} (Demo ID {{5}}, {{6}}). If you have any queries, please contact {{7}} or your agency at +91 90018 00307. | Rahul Kumar; Mathematics; 5:00 PM; Atish Mathur; DID20260101; 60 minutes; your tutor (+91 98765 43210) |
| 11 | ut_class_check | tutor | Hi {{1}}, have you taken today's {{2}} class (Demo ID {{3}})? Tap the button below to confirm. If you have any queries, please contact the student's parents ({{4}}) or your agency at +91 90018 00307. | Atish Mathur; Mathematics; DID20260101; +91 98765 43210 |
| 12 | ut_class_taken | parent | Hi {{1}}, {{2}} has confirmed that today's {{3}} class (Demo ID {{4}}) took place ({{5}}). If you have any queries, please contact your tutor ({{6}}) or your agency at +91 90018 00307. | Rahul Kumar; Atish Mathur; Mathematics; DID20260101; 60 minutes; +91 98765 43210 |
| 13 | ut_payment_received | student | Hi {{1}}, we have received your payment of {{2}} for the {{3}} tuition (Demo ID {{4}}). Receipt No. {{5}}. Thank you! | Rahul Kumar; Rs. 5,000; Mathematics; DID20260101; P-1024 |
| 14 | ut_payout_sent | tutor | Hi {{1}}, we have sent you a payment of {{2}} for your {{3}} tuition (Demo ID {{4}}). Receipt No. {{5}}. | Atish Mathur; Rs. 4,000; Mathematics; DID20260101; P-1025 |

Rules Meta checks (so they are approved the first time):
- A body must not start or end with a variable, and two variables must not sit next to each other.
- Variable values are one line of text: no line breaks, no tabs, no more than 3 spaces in a row. The code takes care of this.
- Keep them informational (Utility). Do not add offers, discounts or promotions.
- The sample values must look real.
