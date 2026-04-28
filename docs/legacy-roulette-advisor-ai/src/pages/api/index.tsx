import React from 'react';
import Layout from '@theme/Layout';
import { useHistory } from '@docusaurus/router';
import { useEffect } from 'react';

export default function ApiRedirect(): JSX.Element {
  const history = useHistory();
  
  useEffect(() => {
    // Redirect to the API documentation entry point
    history.replace('/api/index.html');
  }, [history]);
  
  return (
    <Layout title="API Reference">
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '50vh',
          fontSize: '20px',
        }}>
        <p>Redirecting to API documentation...</p>
      </div>
    </Layout>
  );
}
