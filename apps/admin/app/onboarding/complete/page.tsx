export default function OnboardingComplete() {
  return (
    <main
      data-testid="onboarding-complete"
      style={{
        maxWidth: 720,
        margin: '80px auto',
        padding: 32,
        background: 'white',
        borderRadius: 12,
        textAlign: 'center',
      }}
    >
      <h1>You&apos;re all set</h1>
      <p style={{ color: '#475569' }}>
        CAIA has captured every provider choice and validated every key.
        The pipeline can now spin up your first deployment without
        re-prompting you.
      </p>
    </main>
  );
}
