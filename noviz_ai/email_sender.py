# Send-side counterpart to email_reader.py: our own code, our own
# credentials (Noviz AI Settings' own smtp_host/smtp_port, reusing the
# same account username/password email_reader.py already reads for IMAP —
# one mailbox, one login, two protocols), independent of Frappe's own
# Email Account/Communication machinery. Deliberately does not create a
# Communication record as a side effect (Frappe's own
# frappe.core.doctype.communication.email.make() does that, but this
# module's whole point is not depending on Frappe's Communication table
# as the source of truth for email) — a genuinely sent message is the
# outcome that matters here, not a local record of having sent it.
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid

import frappe


def _smtp_settings():
	settings = frappe.get_single("Noviz AI Settings")
	host = settings.smtp_host
	port = settings.smtp_port or 465
	username = settings.email_username
	password = settings.get_password("email_password", raise_exception=False)
	if not (host and username and password):
		frappe.throw("Noviz AI: SMTP is not configured (Host/Username/Password missing under Noviz AI Settings).")
	return host, port, username, password


def _send(username: str, host: str, port: int, password: str, to_address: str, msg):
	# Port 465 is always implicit-TLS (SMTP_SSL from the first byte);
	# anything else (587, 25, ...) is plaintext-then-STARTTLS — the two
	# real, standard SMTP submission shapes, not something the caller
	# should have to choose between by hand.
	if port == 465:
		with smtplib.SMTP_SSL(host, port, timeout=30) as server:
			server.login(username, password)
			server.sendmail(username, [to_address], msg.as_string())
	else:
		with smtplib.SMTP(host, port, timeout=30) as server:
			server.starttls()
			server.login(username, password)
			server.sendmail(username, [to_address], msg.as_string())


def send_reply(to_address: str, subject: str, body: str):
	"""Real, live SMTP send — the whole point is that this actually
	delivers, not that it queues into Frappe's own outgoing mail flow.
	Raises a plain, real exception on failure (caller's own job to
	surface that honestly, same as any other real send failure) rather
	than swallowing it here."""
	host, port, username, password = _smtp_settings()

	msg = MIMEText(body, "plain", "utf-8")
	msg["Subject"] = subject
	msg["From"] = username
	msg["To"] = to_address
	msg["Date"] = formatdate(localtime=True)
	msg["Message-ID"] = make_msgid()

	_send(username, host, port, password, to_address, msg)


def send_with_attachment(to_address: str, subject: str, body: str, attachments: list):
	"""send_reply's attachment-carrying counterpart — used by
	dispatcher.py's "print_and_email_document" call kind to deliver a
	document's own rendered print-format PDF. `attachments`:
	[(file_name, bytes, mime_type), ...]. Same real, live SMTP send, same
	credentials, same honest failure behavior (raises rather than
	swallows)."""
	host, port, username, password = _smtp_settings()

	msg = MIMEMultipart()
	msg["Subject"] = subject
	msg["From"] = username
	msg["To"] = to_address
	msg["Date"] = formatdate(localtime=True)
	msg["Message-ID"] = make_msgid()
	msg.attach(MIMEText(body, "plain", "utf-8"))

	for file_name, file_bytes, mime_type in attachments:
		maintype, _, subtype = (mime_type or "application/octet-stream").partition("/")
		part = MIMEApplication(file_bytes, _subtype=subtype or "octet-stream")
		part.add_header("Content-Disposition", "attachment", filename=file_name)
		msg.attach(part)

	_send(username, host, port, password, to_address, msg)
