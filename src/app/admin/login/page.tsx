export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">SCHADENDIREKT · ADMIN</span>
        <h1>Anmelden</h1>
        <p>Der Zugang verwendet Benutzer aus der Datenbank und sichere serverseitige Sessions.</p>
      </section>
      <section className="resultCard">
        {error ? <p role="alert">Anmeldung fehlgeschlagen. Bitte Zugangsdaten prüfen oder später erneut versuchen.</p> : null}
        <form action="/api/auth/login" method="post" className="searchForm">
          <label>
            E-Mail
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Passwort
            <input name="password" type="password" autoComplete="current-password" required minLength={12} />
          </label>
          <button type="submit">Anmelden</button>
        </form>
      </section>
    </main>
  );
}
