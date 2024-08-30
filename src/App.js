import React from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import GmailApp from './components/GmailApp';

const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID';

function App() {
  return (
    <GoogleOAuthProvider clientId={"869505371819-utl5gtra4tj4qsapb7tmefo076dn7k41.apps.googleusercontent.com"}>
      <GmailApp />
    </GoogleOAuthProvider>
  );
}

export default App;