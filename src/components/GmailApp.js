import React, { useState, useEffect, useRef } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import axios from 'axios';

function GmailApp() {
  const [user, setUser] = useState(null);
  const [receivedEmails, setReceivedEmails] = useState([]);
  const [sentEmails, setSentEmails] = useState([]);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [nextFetchTime, setNextFetchTime] = useState(null);
  const [statusLogs, setStatusLogs] = useState([]);
  const statusRef = useRef(null);

  const REFRESH_INTERVAL = 30000; // 30 seconds

  const login = useGoogleLogin({
    onSuccess: (codeResponse) => setUser(codeResponse),
    scope: 'https://www.googleapis.com/auth/gmail.modify',
  });

  useEffect(() => {
    if (user) {
      fetchEmails();
      const interval = setInterval(fetchEmails, REFRESH_INTERVAL);
      return () => clearInterval(interval);
    }
  }, [user]);

  const addStatusLog = (message) => {
    setStatusLogs(prevLogs => [...prevLogs, message]);
  };

  const archiveEmail = async (emailId) => {
    try {
      await axios.post(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${emailId}/modify`,
        {
          removeLabelIds: ['INBOX'],
        },
        {
          headers: {
            Authorization: `Bearer ${user.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      addStatusLog(`Archived email: ${emailId}`);
    } catch (error) {
      console.error('Error archiving email:', error);
      addStatusLog(`Error archiving email ${emailId}: ${error.message}`);
    }
  };

  const fetchEmails = async () => {
    // Clear previous status logs
    setStatusLogs([]);
    addStatusLog('Fetching emails...');

    try {
      // Fetch emails from relayer@emailwallet.org
      const relayerResponse = await axios.get(
        'https://www.googleapis.com/gmail/v1/users/me/messages',
        {
          headers: {
            Authorization: `Bearer ${user.access_token}`,
          },
          params: {
            q: 'from:relayer@emailwallet.org in:inbox',
            maxResults: 20,
          },
        }
      );

      const relayerEmails = await Promise.all(
        relayerResponse.data.messages.map(async (message) => {
          const detailResponse = await axios.get(
            `https://www.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
            {
              headers: {
                Authorization: `Bearer ${user.access_token}`,
              },
              params: {
                format: 'full',
              },
            }
          );
          return detailResponse.data;
        })
      );

      // Process relayer emails
      for (const email of relayerEmails) {
        const subjectHeader = email.payload?.headers.find(h => h.name === 'Subject')?.value || 'No Subject';
        const bodyContent = getEmailBody(email);
        const messageId = email.payload?.headers.find(h => h.name === 'Message-ID')?.value || '';

        if (bodyContent.toLowerCase().includes('please reply "confirm" to this email')) {
          // Check if a confirm reply already exists
          const replyResponse = await axios.get(
            'https://www.googleapis.com/gmail/v1/users/me/messages',
            {
              headers: {
                Authorization: `Bearer ${user.access_token}`,
              },
              params: {
                q: `in:sent to:relayer@emailwallet.org subject:"Re: ${subjectHeader}" "confirm"`,
                maxResults: 1,
              },
            }
          );

          if (replyResponse.data.messages && replyResponse.data.messages.length > 0) {
            addStatusLog(`Confirmation already sent for: "${subjectHeader}"`);
          } else {
            await handleAutoReply(email);
            addStatusLog(`Auto-replied to: "${subjectHeader}"`);
          }
        } else {
          addStatusLog(`Ignored email: "${subjectHeader}" - Reason: Does not contain confirmation request phrase`);
        }

        // Archive the email after processing
        await archiveEmail(email.id);
      }

      // Fetch other emails (received and sent)
      const response = await axios.get(
        'https://www.googleapis.com/gmail/v1/users/me/messages',
        {
          headers: {
            Authorization: `Bearer ${user.access_token}`,
          },
          params: {
            maxResults: 20,
          },
        }
      );
      
      const emailsWithDetails = await Promise.all(
        response.data.messages.map(async (message) => {
          const detailResponse = await axios.get(
            `https://www.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
            {
              headers: {
                Authorization: `Bearer ${user.access_token}`,
              },
            }
          );
          return detailResponse.data;
        })
      );
      
      const received = [];
      const sent = [];
      
      emailsWithDetails.forEach(email => {
        const fromHeader = email.payload?.headers.find(h => h.name === 'From')?.value || '';
        if (fromHeader.includes(user.email)) {
          sent.push(email);
        } else {
          received.push(email);
        }
      });
      
      setReceivedEmails(received);
      setSentEmails(sent);
      addStatusLog('Emails fetched, processed, and archived successfully');
      setNextFetchTime(new Date().getTime() + REFRESH_INTERVAL);

    } catch (error) {
      console.error('Error fetching emails:', error);
      addStatusLog(`Error fetching emails: ${error.message}`);
    }
  };

  const handleAutoReply = async (email) => {
    const fromHeader = email.payload?.headers.find(h => h.name === 'From')?.value || '';
    const subjectHeader = email.payload?.headers.find(h => h.name === 'Subject')?.value || '';
    const messageId = email.payload?.headers.find(h => h.name === 'Message-ID')?.value || '';
    
    try {
      const messageContent = `To: ${fromHeader}\r\nSubject: Re: ${subjectHeader}\r\nIn-Reply-To: ${messageId}\r\nReferences: ${messageId}\r\n\r\nconfirm`;
      const message = btoa(unescape(encodeURIComponent(messageContent))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      await axios.post(
        'https://www.googleapis.com/gmail/v1/users/me/messages/send',
        { raw: message },
        {
          headers: {
            Authorization: `Bearer ${user.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (error) {
      console.error('Error sending auto-reply:', error);
      throw error;
    }
  };

  const sendEmail = async (e) => {
    e.preventDefault();
    try {
      addStatusLog('Sending email...');
      let messageContent = `To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`;
      if (replyTo) {
        messageContent = `To: ${replyTo.from}\r\nSubject: Re: ${replyTo.subject}\r\nIn-Reply-To: ${replyTo.messageId}\r\nReferences: ${replyTo.messageId}\r\n\r\n${body}`;
      }
      const message = btoa(unescape(encodeURIComponent(messageContent))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      await axios.post(
        'https://www.googleapis.com/gmail/v1/users/me/messages/send',
        { raw: message },
        {
          headers: {
            Authorization: `Bearer ${user.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      addStatusLog('Email sent successfully');
      setTo('');
      setSubject('');
      setBody('');
      setReplyTo(null);
      setShowModal(false);
      fetchEmails();
    } catch (error) {
      console.error('Error sending email:', error);
      addStatusLog(`Error sending email: ${error.message}`);
    }
  };

  const handleReply = (email) => {
    const fromHeader = email.payload?.headers.find(h => h.name === 'From')?.value || '';
    const subjectHeader = email.payload?.headers.find(h => h.name === 'Subject')?.value || '';
    const messageId = email.payload?.headers.find(h => h.name === 'Message-ID')?.value || '';
    
    setReplyTo({
      from: fromHeader,
      subject: subjectHeader,
      messageId: messageId,
    });
    setTo(fromHeader);
    setSubject(`Re: ${subjectHeader}`);
    setBody(`\n\nOn ${email.payload?.headers.find(h => h.name === 'Date')?.value || ''}, ${fromHeader} wrote:\n> ${email.snippet}`);
    setShowModal(true);
    addStatusLog(`Replying to email from ${fromHeader}`);
  };

  const handleArchive = async (email) => {
    try {
      addStatusLog('Archiving email...');
      await axios.post(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${email.id}/modify`,
        {
          removeLabelIds: ['INBOX'],
        },
        {
          headers: {
            Authorization: `Bearer ${user.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      addStatusLog('Email archived successfully');
      fetchEmails();
    } catch (error) {
      console.error('Error archiving email:', error);
      addStatusLog(`Error archiving email: ${error.message}`);
    }
  };

  const renderEmailList = (emails, title) => (
    <div className="email-section" style={styles.emailSection}>
      <h2 style={styles.h2}>{title}</h2>
      <div className="email-list" style={styles.emailList}>
        {emails.map((email) => (
          <div key={email.id} className="email-item" style={{...styles.emailItem, backgroundColor: title === "Sent Emails" ? '#f8f9fa' : 'white'}}>
            <h3 style={styles.h3}>{email.payload?.headers.find(h => h.name === 'Subject')?.value || 'No Subject'}</h3>
            <p className="email-from" style={styles.emailFrom}>{email.payload?.headers.find(h => h.name === 'From')?.value || 'Unknown'}</p>
            <p className="email-date" style={styles.emailDate}>{email.payload?.headers.find(h => h.name === 'Date')?.value || 'Unknown'}</p>
            <p className="email-snippet" style={styles.emailSnippet}>{email.snippet || 'No preview available'}</p>
            {title === "Received Emails" && (
              <div style={styles.emailActions}>
                <button onClick={() => handleReply(email)} style={styles.actionButton}>Reply</button>
                <button onClick={() => handleArchive(email)} style={styles.actionButton}>Archive</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const renderModal = () => (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h2 style={styles.h2}>{replyTo ? 'Reply to Email' : 'Send Email'}</h2>
        <form onSubmit={sendEmail} style={styles.emailForm}>
          <input
            type="email"
            placeholder="To"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={styles.input}
            required
            disabled={replyTo !== null}
          />
          <input
            type="text"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            style={styles.input}
            required
            disabled={replyTo !== null}
          />
          <textarea
            placeholder="Body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            style={styles.textarea}
            required
          />
          <div style={styles.modalButtons}>
            <button type="submit" style={styles.sendButton}>{replyTo ? 'Send Reply' : 'Send Email'}</button>
            <button onClick={() => setShowModal(false)} style={styles.cancelButton}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );

  const renderStatusBar = () => (
    <div style={styles.statusBar} ref={statusRef}>
      {statusLogs.map((log, index) => (
        <div key={index} style={styles.statusItem}>
          <span style={styles.lineNumber}>{index + 1}</span>
          <span style={styles.logMessage}>{log}</span>
        </div>
      ))}
    </div>
  );

  useEffect(() => {
    if (statusRef.current) {
      statusRef.current.scrollTop = statusRef.current.scrollHeight;
    }
  }, [statusLogs]);

  return (
    <div className="gmail-app" style={styles.gmailApp}>
      {user ? (
        <div className="app-container" style={styles.appContainer}>
          <header style={styles.header}>
            <h1 style={styles.h1}>Gmail App</h1>
            <div style={styles.headerActions}>
              <button className="refresh-button" onClick={fetchEmails} style={styles.refreshButton}>Refresh Emails</button>
              {nextFetchTime && (
                <span style={styles.nextFetchTime}>
                  Next fetch in: {Math.max(0, Math.floor((nextFetchTime - new Date().getTime()) / 1000))}s
                </span>
              )}
            </div>
          </header>
          {renderStatusBar()}
          {renderEmailList(receivedEmails, "Received Emails")}
          {renderEmailList(sentEmails, "Sent Emails")}
          <button onClick={() => setShowModal(true)} style={styles.composeButton}>Compose Email</button>
          {showModal && renderModal()}
        </div>
      ) : (
        <div className="login-container" style={styles.loginContainer}>
          <h1 style={styles.h1}>Welcome to Gmail App</h1>
          <button className="login-button" onClick={() => login()} style={styles.loginButton}>Sign in with Google</button>
        </div>
      )}
    </div>
  );
}

const styles = {
  gmailApp: {
    fontFamily: "'Roboto', sans-serif",
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px',
    backgroundColor: '#f5f5f5',
    minHeight: '100vh',
  },
  appContainer: {
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
    padding: '20px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    borderBottom: '1px solid #e0e0e0',
    paddingBottom: '10px',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
  },
  h1: {
    fontSize: '24px',
    color: '#1a73e8',
    margin: 0,
  },
  h2: {
    fontSize: '20px',
    color: '#202124',
    marginBottom: '10px',
  },
  h3: {
    fontSize: '16px',
    color: '#202124',
    margin: '0 0 5px 0',
  },
  statusBar: {
    backgroundColor: '#e8f0fe',
    borderRadius: '4px',
    padding: '10px',
    marginBottom: '20px',
    maxHeight: '200px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  statusItem: {
    backgroundColor: 'white',
    border: '1px solid #1967d2',
    borderRadius: '4px',
    color: '#1967d2',
    padding: '8px 12px',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'flex-start',
  },
  lineNumber: {
    minWidth: '30px',
    marginRight: '10px',
    color: '#666',
    fontWeight: 'bold',
  },
  logMessage: {
    flex: 1,
  },
  emailSection: {
    marginBottom: '30px',
  },
  emailList: {
    display: 'grid',
    gap: '15px',
  },
  emailItem: {
    padding: '15px',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    transition: 'box-shadow 0.3s ease',
    ':hover': {
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    },
  },
  emailFrom: {
    fontSize: '14px',
    color: '#5f6368',
    margin: '0 0 5px 0',
  },
  emailDate: {
    fontSize: '12px',
    color: '#80868b',
    margin: '0 0 10px 0',
  },
  emailSnippet: {
    fontSize: '14px',
    color: '#202124',
    margin: 0,
  },
  emailActions: {
    marginTop: '10px',
    display: 'flex',
    gap: '10px',
  },
  actionButton: {
    backgroundColor: '#1a73e8',
    color: 'white',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'background-color 0.3s ease',
    ':hover': {
      backgroundColor: '#1765cc',
    },
  },
  refreshButton: {
    backgroundColor: '#1a73e8',
    color: 'white',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    marginRight: '10px',
  },
  nextFetchTime: {
    fontSize: '14px',
    color: '#5f6368',
  },
  composeButton: {
    backgroundColor: '#1a73e8',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '24px',
    cursor: 'pointer',
    fontSize: '16px',
    position: 'fixed',
    bottom: '30px',
    right: '30px',
    boxShadow: '0 2px 5px rgba(0, 0, 0, 0.2)',
  },
  loginContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
  },
  loginButton: {
    backgroundColor: '#1a73e8',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '16px',
    marginTop: '20px',
  },
};

// Helper function to extract email body
const getEmailBody = (email) => {
  const decodeBase64 = (data) => {
    return decodeURIComponent(escape(atob(data.replace(/-/g, '+').replace(/_/g, '/'))));
  };

  const getPartContent = (part) => {
    if (part.body.data) {
      return decodeBase64(part.body.data);
    } else if (part.parts) {
      return part.parts.map(getPartContent).join('\n');
    }
    return '';
  };

  if (email.payload.parts) {
    // Multipart email
    return email.payload.parts.map(getPartContent).join('\n');
  } else if (email.payload.body.data) {
    // Single part email
    return decodeBase64(email.payload.body.data);
  }
  return ''; // Return empty string if no body found
};

export default GmailApp;