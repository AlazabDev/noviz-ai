# A scheduled task that fails currently only shows up if someone opens
# its own "Noviz AI Scheduled Task" record and reads Last Status — real
# risk of it going unnoticed for days (the exact "fails silently" problem
# flagged for this feature). This module is the fix: called from
# scheduled_tasks.py's own except block, it pushes the failure OUT to a
# real person instead of waiting for one to come looking.
#
# Both channels are optional and independent — a Settings doc with only
# Alert Email filled in still emails; only Slack Webhook URL filled in
# still posts to Slack; neither filled in means this module quietly does
# nothing (not every deployment wants alerting, and that's a valid
# choice, not a misconfiguration).
import frappe


def notify_scheduled_task_failure(task_name: str, error_message: str):
	settings = frappe.get_single("Noviz AI Settings")
	error_message = (error_message or "")[:1000]

	if settings.alert_email:
		_send_email_alert(settings.alert_email, task_name, error_message)
	if settings.get_password("slack_webhook_url", raise_exception=False):
		_send_slack_alert(settings.get_password("slack_webhook_url", raise_exception=False), task_name, error_message)


def _send_email_alert(to_address: str, task_name: str, error_message: str):
	# Reuses the exact same SMTP path (and Settings) as
	# print_and_email_document / reply_communication in dispatcher.py —
	# one already-configured email identity for everything this app
	# sends, not a second one to set up.
	from noviz_ai.email_sender import send_reply

	try:
		send_reply(
			to_address,
			f"Noviz AI: scheduled task \"{task_name}\" failed",
			f'The scheduled automation "{task_name}" failed on its last run.\n\n'
			f"Error:\n{error_message}\n\n"
			f'Open the "Noviz AI Scheduled Task" record in your ERPNext desk for the full history.',
		)
	except Exception:
		# The alert itself failing (bad SMTP creds, network blip) must
		# never mask the original task failure it's reporting on — log
		# and move on, same failure-isolation reasoning
		# scheduled_tasks.py already applies per-task.
		frappe.log_error(title=f'Noviz AI: failed to email failure alert for "{task_name}"', message=frappe.get_traceback())


def _send_slack_alert(webhook_url: str, task_name: str, error_message: str):
	import requests

	try:
		requests.post(
			webhook_url,
			json={"text": f':red_circle: *Noviz AI scheduled task failed:* `{task_name}`\n>{error_message}'},
			timeout=10,
		)
	except Exception:
		frappe.log_error(title=f'Noviz AI: failed to post Slack alert for "{task_name}"', message=frappe.get_traceback())
