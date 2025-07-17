require("dotenv").config();
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;
const cors = require("cors");
const admin = require("firebase-admin");

const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
const cron = require("node-cron");
app.use(cors());
app.use(express.json());

const serviceAccount = require("./NEXORA_FB_KEY.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("Nexora");

    const usersCollection = db.collection("allUsers");
    const apartmentsCollection = db.collection("allApartments");
    const agreementsCollection = db.collection("allAgreements");
    const rentPaymentsCollection = db.collection("allRentPayments");
    // custom middlewares here
    const verifyFireBaseToken = async (req, res, next) => {
      // console.log('header in iddleware', req.headers);
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = authHeader.split(" ")[1];

      if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      //  verify the token here
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        return res.status(403).send({ message: "forbidden access" });
      }
    };

    // verify admin role
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      // used just for checking
      // if (!user || user.role === "admin") {

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
    // verify rider role
    const verifyMembar = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      // used just for checking
      // if (!user || user.role === "admin") {

      if (!user || user.role !== "member") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    cron.schedule("0 1 * * *", async () => {
      console.log("⏰ Running monthly rent generation...");
      const now = new Date();

      // Find members whose nextRentDate is due
      const dueUsers = await usersCollection
        .find({
          role: "member",
          nextRentDate: { $lte: now },
        })
        .toArray();

      for (const u of dueUsers) {
        // Get last rent amount
        const lastRent = u.rentHistory?.[u.rentHistory.length - 1];
        if (!lastRent) continue;

        // Add new rent payment
        await rentPaymentsCollection.insertOne({
          userEmail: u.email,
          month: now.toLocaleString("default", {
            month: "long",
            year: "numeric",
          }),
          amount: lastRent.amount,
          generatedAt: now,
          status: "unpaid",
        });

        // Update user's rent history and next due date
        const nextDate = new Date(now);
        nextDate.setMonth(nextDate.getMonth() + 1);

        await usersCollection.updateOne(
          { email: u.email },
          {
            $set: { nextRentDate: nextDate },
            $push: {
              rentHistory: {
                month: now.toLocaleString("default", {
                  month: "long",
                  year: "numeric",
                }),
                amount: lastRent.amount,
                createdAt: now,
              },
            },
          }
        );
      }
    });

    app.get("/rent-payments/:email", verifyFireBaseToken, async (req, res) => {
      const email = req.params.email;
      const status = req.query.status;
      const filter = { userEmail: email };
      if (status) filter.status = status;

      try {
        const rents = await rentPaymentsCollection.find(filter).toArray();
        res.json(rents);
      } catch (err) {
        console.error("GET /rent-payments/:email error:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.patch("/rent-payments/:id", verifyFireBaseToken, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body; // expect "paid"
      try {
        await rentPaymentsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: status || "paid", paidAt: new Date() } }
        );
        res.json({ success: true, message: "Rent marked as paid." });
      } catch (err) {
        console.error("PATCH /rent-payments/:id error:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // post an user to db
    app.post("/users", async (req, res) => {
      const { email, role, last_log_in, created_at } = req.body;

      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }

      const userExists = await usersCollection.findOne({ email });

      if (userExists) {
        // User already exists — update last_log_in only
        const updateResult = await usersCollection.updateOne(
          { email },
          { $set: { last_log_in } } // or use `new Date()` for server-side timestamp
        );

        return res.status(200).send({
          message: "User already exists, last_log_in updated",
          inserted: false,
          updated: updateResult.modifiedCount > 0,
        });
      }

      // New user — insert all data
      const user = {
        email,
        role: role || "user",
        last_log_in,
        created_at,
      };

      const insertResult = await usersCollection.insertOne(user);

      return res.status(201).send({
        message: "New user created",
        inserted: true,
        result: insertResult,
      });
    });

    // ✅ GET Apartments with pagination + rent filter
    app.get("/apartments", async (req, res) => {
      try {
        // 📌 Query params for pagination
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 8; // fits better with grid-cols-4
        const skip = (page - 1) * limit;

        // 📌 Query params for filtering
        const minRent = parseInt(req.query.minRent) || 0;
        const maxRent = parseInt(req.query.maxRent) || 9999999;

        // 📌 Query params for sorting
        const sortBy = req.query.sortBy || "rent"; // default sort field
        const sortOrder = req.query.sortOrder === "desc" ? -1 : 1; // default ascending

        // 🔍 Build the MongoDB filter query
        const query = {
          rent: { $gte: minRent, $lte: maxRent },
        };

        // 🧮 Count total documents matching query
        const total = await apartmentsCollection.countDocuments(query);

        // 📦 Fetch paginated & sorted apartments
        const apartments = await apartmentsCollection
          .find(query)
          .sort({ [sortBy]: sortOrder }) // ✅ dynamic sorting
          .skip(skip)
          .limit(limit)
          .toArray();

        // ✅ Respond with paginated result
        res.json({
          success: true,
          total,
          page,
          pages: Math.ceil(total / limit),
          apartments,
        });
      } catch (err) {
        console.error(" GET /apartments error:", err);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // ✅ POST Agreement
    app.post("/agreements", verifyFireBaseToken, async (req, res) => {
      try {
        const { availability } = req.body;
        const agreementData = req.body;

        if (availability === false) {
          return res.status(400).json({
            success: false,
            message: "Apartment Unavailable",
          });
        }
        // optional validation
        if (!agreementData.userEmail || !agreementData.apartmentNo) {
          return res
            .status(400)
            .json({ success: false, message: "Missing required fields" });
        }

        // check if user already applied for an apartment
        const exists = await agreementsCollection.findOne({
          userEmail: agreementData.userEmail,
        });
        if (exists) {
          return res.status(400).json({
            success: false,
            message: "Already applied for an apartment",
          });
        }

        agreementData.status = "pending";
        agreementData.createdAt = new Date();

        await agreementsCollection.insertOne(agreementData);

        res.json({
          success: true,
          message: "Agreement request submitted successfully",
        });
      } catch (err) {
        console.error("POST /agreements error:", err);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // ✅ Get user role by email
    app.get("/users/:email/role", async (req, res) => {
      try {
        const email = req.params.email;
        if (!email) {
          return res.status(400).json({ message: "Email is required" });
        }

        const user = await usersCollection.findOne({ email });

        if (!user) {
          // default role if not found
          return res.json({ role: "user" });
        }

        res.json({ role: user.role || "user" });
      } catch (error) {
        console.error("Error fetching user role:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // GET agreements by user
    app.get(
      "/agreements/user/:email",
      verifyFireBaseToken,
      async (req, res) => {
        const email = req.params.email;
        const status = req.query.status;
        let filter = { userEmail: email };
        if (status) filter.status = status;
        const result = await agreementsCollection.find(filter).toArray();
        res.send(result);
      }
    );

    // GET pending agreements
    app.get(
      "/agreements",
      verifyFireBaseToken,
      verifyAdmin,
      async (req, res) => {
        const status = req.query.status;
        const filter = status ? { status } : {};
        const agreements = await agreementsCollection.find(filter).toArray();
        res.send(agreements);
      }
    );

    // PATCH: Accept or Reject Agreement
    app.patch(
      "/agreements/:id",
      verifyFireBaseToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { action, userEmail } = req.body;

        try {
          const objectId = new ObjectId(id);

          // find the agreement
          const agreement = await agreementsCollection.findOne({
            _id: objectId,
          });
          if (!agreement) {
            return res.status(404).send({ message: "Agreement not found" });
          }

          const updateDoc = { $set: { decisionAt: new Date() } };

          if (action === "accept") {
            // update agreement status
            updateDoc.$set.status = "accepted";

            // ⭐️ Update user role to member
            await usersCollection.updateOne(
              { email: userEmail },
              { $set: { role: "member" } }
            );

            // ⭐️ Update apartment (available -> false, rentedBy = userEmail)
            await apartmentsCollection.updateOne(
              { _id: new ObjectId(agreement.apartmentId) },
              { $set: { available: false, rentedBy: userEmail } }
            );

            // ⭐️ Create initial rent record
            const monthName = new Date().toLocaleString("default", {
              month: "long",
              year: "numeric",
            });

            await rentPaymentsCollection.insertOne({
              userEmail,
              month: monthName,
              amount: agreement.rent,
              generatedAt: new Date(),
              status: "unpaid",
            });

            // ⭐️ Update user profile with nextRentDate and rentHistory
            const nextDate = new Date();
            nextDate.setMonth(nextDate.getMonth() + 1);

            await usersCollection.updateOne(
              { email: userEmail },
              {
                $set: { nextRentDate: nextDate },
                $push: {
                  rentHistory: {
                    month: monthName,
                    amount: agreement.rent,
                    createdAt: new Date(),
                  },
                },
              }
            );
          } else if (action === "reject") {
            // just mark agreement as rejected
            updateDoc.$set.status = "rejected";
          }

          // apply update to agreement
          await agreementsCollection.updateOne({ _id: objectId }, updateDoc);

          res.send({ success: true, action });
        } catch (err) {
          console.error("PATCH /agreements/:id error:", err);
          res.status(500).send({ message: "Server error" });
        }
      }
    );

    cron.schedule("0 1 1 * *", async () => {
      console.log("⏰ Running monthly rent generation and downgrade check...");
      const now = new Date();

      const dueUsers = await usersCollection
        .find({
          role: "member",
          nextRentDate: { $lte: now },
        })
        .toArray();

      for (const u of dueUsers) {
        const lastRent = u.rentHistory?.[u.rentHistory.length - 1];
        if (!lastRent) continue;

        // ➡️ Insert new unpaid rent
        await rentPaymentsCollection.insertOne({
          userEmail: u.email,
          month: now.toLocaleString("default", {
            month: "long",
            year: "numeric",
          }),
          amount: lastRent.amount,
          generatedAt: now,
          status: "unpaid",
        });
        
        // ➡️ Update nextRentDate & history
        const nextDate = new Date(now);
        nextDate.setMonth(nextDate.getMonth() + 1);
        await usersCollection.updateOne(
          { email: u.email },
          {
            $set: { nextRentDate: nextDate },
            $push: {
              rentHistory: {
                month: now.toLocaleString("default", {
                  month: "long",
                  year: "numeric",
                }),
                amount: lastRent.amount,
                createdAt: now,
              },
            },
          }
        );

        // ➡️ Check unpaid and downgrade
        const unpaidCount = await rentPaymentsCollection.countDocuments({
          userEmail: u.email,
          status: "unpaid",
        });

        if (unpaidCount >= 3) {
          await usersCollection.updateOne(
            { email: u.email },
            { $set: { role: "user" } }
          );
          console.log(`❌ Downgraded ${u.email} to user due to 3 unpaid rents`);
        }
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
