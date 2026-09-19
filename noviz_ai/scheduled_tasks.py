# Local, relay-independent automation: a "Noviz AI Scheduled Task" is a
# plain-language prompt (e.g. "email today's overdue Sales Invoices to
# accounts@example.com") that runs on its own schedule, exactly as if
# its configured `run_as_user` had typed that prompt into the chat page
# themselves. Reuses api.run_agent_turn — the SAME relay round trip +
# fetch/continue loop a live chat message drives — so every call kind
# this app supports (get_list/create_doc/print_and_email_document/...)
# already works here for free; this file's only real job is picking
# which tasks are due and running each one as the RIGHT user.
#
# No conversation memory between runs on purpose (previous_turn_id is
# never passed) — each scheduled run is a fresh, self-contained turn,
# same as opening the chat page new every time.
import frappe

from noviz_ai.api import run_agent_turn


def _run_tasks(frequency: str):
	tasks = frappe.get_all(
		"Noviz AI Scheduled Task",
		filters={"enabled": 1, "frequency": frequency},
		pluck="name",
	)
	for task_name in tasks:
		_run_one_task(task_name)


def _run_one_task(task_name: str):
	# Each task runs in isolation — one task's failure (a bad prompt, a
	# relay hiccup, a permission gap for that specific user) must never
	# stop the rest of this batch from running.
	task = frappe.get_doc("Noviz AI Scheduled Task", task_name)
	original_user = frappe.session.user
	try:
		# Real per-user permission enforcement — dispatcher.py's own
		# has_permission/get_list checks run against WHOEVER
		# frappe.session.user is at call time, same as a live chat
		# request. Setting it here (and always restoring it in
		# `finally`) is the standard Frappe pattern for a background job
		# that must act as a specific user rather than Administrator.
		frappe.set_user(task.run_as_user)
		result = run_agent_turn(task.prompt)
		task.db_set("last_status", "Success", update_modified=False)
		task.db_set("last_result", frappe.as_json(result)[:1900], update_modified=False)
	except Exception as e:
		frappe.log_error(title=f"Noviz AI: scheduled task '{task_name}' failed", message=frappe.get_traceback())
		task.db_set("last_status", "Failed", update_modified=False)
		task.db_set("last_result", str(e)[:1900], update_modified=False)
	finally:
		task.db_set("last_run", frappe.utils.now_datetime(), update_modified=False)
		frappe.set_user(original_user)
		frappe.db.commit()  # nosemgrep: frappe-manual-commit


def run_hourly():
	_run_tasks("Hourly")


def run_daily():
	_run_tasks("Daily")


def run_weekly():
	_run_tasks("Weekly")


def run_monthly():
	_run_tasks("Monthly")
