const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());

// --- Connexion MySQL
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "butterfly20005.", // ⚠ Ne jamais exposer un mot de passe en production !
  database: "support_tickets_db",
});

db.connect(err => {
  if (err) {
    console.error("❌ Erreur de connexion DB:", err);
    process.exit(1);
  }
  console.log("✅ Connecté à MySQL");
});

// --- Helper : calcul du temps de résolution
function formatResolutionTime(createdAt, resolvedAt) {
  if (!resolvedAt) return "-";
  const diffMs = new Date(resolvedAt) - new Date(createdAt);
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
  return `${hours}h ${minutes}m ${seconds}s`;
}

// --- Générer le prochain ID
app.get("/tickets/next-id/:type", (req, res) => {
  const type = (req.params.type || "").toUpperCase();
  if (!["DMD", "INC"].includes(type)) {
    return res.status(400).json({ error: "Type invalide" });
  }

  const query = "SELECT TicketID FROM tickets WHERE TicketID LIKE ? ORDER BY TicketID DESC LIMIT 1";
  db.query(query, [`${type}%`], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    let nextNumber = 1;
    if (results.length > 0) {
      const numericPart = parseInt(results[0].TicketID.replace(type, ""), 10);
      if (!isNaN(numericPart)) nextNumber = numericPart + 1;
    }

    const nextId = `${type}${String(nextNumber).padStart(3, "0")}`;
    res.json({ nextId });
  });
});

// --- Récupérer toutes les catégories
app.get("/categories", (req, res) => {
  db.query("SELECT * FROM categories ORDER BY CategoryName", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// --- Ajouter un ticket
app.post("/tickets", (req, res) => {
  const { TicketID, nameUser, Description, Priority, team, CategoryName } = req.body;
  const sql = `
    INSERT INTO tickets (TicketID, nameUser, Description, Priority, team, CategoryName, Status, CreatedAt)
    VALUES (?, ?, ?, ?, ?, ?, 'Ouvert', NOW())
  `;
  db.query(sql, [TicketID, nameUser, Description, Priority, team, CategoryName], err => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ message: "Ticket ajouté", ticketID: TicketID });
  });
});

// --- Récupérer tous les tickets
app.get("/tickets", (req, res) => {
  db.query("SELECT * FROM tickets ORDER BY CreatedAt ASC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    const tickets = results.map(t => ({
      ...t,
      ResolutionTime: t.ResolvedAt ? formatResolutionTime(t.CreatedAt, t.ResolvedAt) : "-"
    }));
    res.json(tickets);
  });
});

// --- Modifier un ticket
app.put("/tickets/:id", (req, res) => {
  const ticketId = req.params.id;
  const updates = req.body || {};
  const allowed = ["Description", "Priority", "team", "CategoryName", "nameUser"];
  const fields = [];
  const values = [];

  allowed.forEach(k => {
    if (updates[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(updates[k]);
    }
  });

  if (!fields.length) return res.status(400).json({ error: "Aucun champ valide à mettre à jour" });

  const updateQuery = `UPDATE tickets SET ${fields.join(", ")} WHERE TicketID = ?`;
  values.push(ticketId);

  db.query(updateQuery, values, err => {
    if (err) return res.status(500).json({ error: err.message });

    db.query("SELECT * FROM tickets WHERE TicketID = ?", [ticketId], (err2, results) => {
      if (err2 || !results.length) return res.json({ message: "Ticket mis à jour." });
      const t = results[0];
      t.ResolutionTime = t.ResolvedAt ? formatResolutionTime(t.CreatedAt, t.ResolvedAt) : "-";
      res.json({ message: "Ticket mis à jour.", ticket: t });
    });
  });
});

// --- Résoudre un ticket
app.put("/tickets/:id/resolve", (req, res) => {
  const ticketId = req.params.id;
  const { note, resolvedBy, Description, Priority, CategoryName } = req.body;

  const query = `
    UPDATE tickets 
    SET Status='Fermé', 
        ResolutionNote=?, 
        ResolvedBy=?, 
        ResolvedAt=NOW(),
        Description=COALESCE(?, Description),
        Priority=COALESCE(?, Priority),
        CategoryName=COALESCE(?, CategoryName)
    WHERE TicketID=?
  `;

  db.query(query, [note || "", resolvedBy || "", Description, Priority, CategoryName, ticketId], err => {
    if (err) return res.status(500).json({ error: err.message });

    db.query("SELECT * FROM tickets WHERE TicketID = ?", [ticketId], (err2, results) => {
      if (err2 || !results.length) return res.status(500).json({ error: "Ticket introuvable" });
      const t = results[0];
      t.ResolutionTime = t.ResolvedAt ? formatResolutionTime(t.CreatedAt, t.ResolvedAt) : "-";
      res.json({ message: "Ticket résolu", ticket: t });
    });
  });
});

// --- Supprimer les tickets fermés
app.delete("/tickets/delete-closed", (req, res) => {
  db.query("DELETE FROM tickets WHERE Status='Fermé'", (err, result) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, deleted: result.affectedRows });
  });
});

// --- Authentification simple (⚠ à ne pas utiliser tel quel en production)
const IT_USERS = {
  boutaina: "1234",
  tarik: "1234",
  zakaria: "1234",
  sanaa: "1234",
  mostafa: "1234",
  salim: "1234"
};

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (IT_USERS[username] && IT_USERS[username] === password) {
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, message: "Nom ou mot de passe incorrect" });
});

// --- Lancer le serveur
app.listen(port, () => {
  console.log(`🚀 Serveur backend lancé sur http://localhost:${port}`);
});
