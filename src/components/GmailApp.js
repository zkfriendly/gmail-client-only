import React, { useState, useEffect } from 'react';
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

  const login = useGoogleLogin({
    onSuccess: (codeResponse) => setUser(codeResponse),
    scope: 'https://www.googleapis.com/auth/gmail.modify',
  });

  useEffect(() => {
    if (user) {
      fetchEmails();
    }
  }, [user]);

  const fetchEmails = async () => {
    try {
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
    } catch (error) {
      console.error('Error fetching emails:', error);
    }
  };

  const sendEmail = async (e) => {
    e.preventDefault();
    try {
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
      console.log('Email sent successfully');
      setTo('');
      setSubject('');
      setBody('');
      setReplyTo(null);
      setShowModal(false);
      fetchEmails();
    } catch (error) {
      console.error('Error sending email:', error);
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
  };

  const renderEmailList = (emails, title) => (
    <div className="email-section" style={styles.emailSection}>
      <h2 style={styles.h2}>{title}</h2>
      <div className="email-list" style={styles.emailList}>
        {emails.map((email) => (
          <div key={email.id} className="email-item" style={{...styles.emailItem, backgroundColor: title === "Sent Emails" ? '#e8f0fe' : 'white'}}>
            <h3 style={styles.h3}>{email.payload?.headers.find(h => h.name === 'Subject')?.value || 'No Subject'}</h3>
            <p className="email-from" style={styles.emailFrom}>{email.payload?.headers.find(h => h.name === 'From')?.value || 'Unknown'}</p>
            <p className="email-date" style={styles.emailDate}>{email.payload?.headers.find(h => h.name === 'Date')?.value || 'Unknown'}</p>
            <p className="email-snippet" style={styles.emailSnippet}>{email.snippet || 'No preview available'}</p>
            {title === "Received Emails" && (
              <button onClick={() => handleReply(email)} style={styles.replyButton}>Reply</button>
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

  return (
    <div className="gmail-app" style={styles.gmailApp}>
      {user ? (
        <div className="app-container" style={styles.appContainer}>
          <header style={styles.header}>
            <h1 style={styles.h1}>Gmail App</h1>
            <button className="refresh-button" onClick={fetchEmails} style={styles.refreshButton}>Refresh Emails</button>
          </header>
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
    fontFamily: 'Arial, sans-serif',
    maxWidth: '800px',
    margin: '0 auto',
    padding: '20px',
  },
  appContainer: {
    backgroundColor: '#f5f5f5',
    borderRadius: '8px',
    padding: '20px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  h1: {
    color: '#4285f4',
    margin: '0',
  },
  h2: {
    color: '#4285f4',
    marginBottom: '15px',
  },
  refreshButton: {
    backgroundColor: '#4285f4',
    color: 'white',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  emailSection: {
    marginBottom: '30px',
  },
  emailList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  emailItem: {
    borderRadius: '4px',
    padding: '10px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)',
  },
  h3: {
    margin: '0 0 10px 0',
    color: '#333',
  },
  emailFrom: {
    fontWeight: 'bold',
    margin: '5px 0',
  },
  emailDate: {
    color: '#666',
    fontSize: '0.9em',
    margin: '5px 0',
  },
  emailSnippet: {
    margin: '10px 0 0 0',
    color: '#333',
  },
  loginContainer: {
    textAlign: 'center',
    padding: '50px',
    backgroundColor: '#f5f5f5',
    borderRadius: '8px',
  },
  loginButton: {
    backgroundColor: '#4285f4',
    color: 'white',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '16px',
    marginTop: '20px',
  },
  emailForm: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '4px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)',
  },
  input: {
    width: '100%',
    padding: '10px',
    marginBottom: '10px',
    borderRadius: '4px',
    border: '1px solid #ccc',
  },
  textarea: {
    width: '100%',
    padding: '10px',
    marginBottom: '10px',
    borderRadius: '4px',
    border: '1px solid #ccc',
    minHeight: '100px',
  },
  sendButton: {
    backgroundColor: '#4285f4',
    color: 'white',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '16px',
  },
  replyButton: {
    backgroundColor: '#34a853',
    color: 'white',
    border: 'none',
    padding: '5px 10px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    marginTop: '10px',
  },
  cancelButton: {
    backgroundColor: '#ea4335',
    color: 'white',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '16px',
    marginLeft: '10px',
  },
  composeButton: {
    backgroundColor: '#4285f4',
    color: 'white',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '16px',
    marginTop: '20px',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    width: '80%',
    maxWidth: '600px',
  },
  modalButtons: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: '20px',
  },
};

export default GmailApp;