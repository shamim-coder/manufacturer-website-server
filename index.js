const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(cors());

const jwtVerify = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: "Error 401 - Unauthorized!" });
    }
    const token = authHeader.split(" ")[1];

    jwt.verify(token, process.env.JWT_ACCESS_TOKEN, async (err, decoded) => {
        if (err) {
            return res.status(403).send({ message: "Error 403 - Forbidden" });
        }
        req.decoded = decoded;
        await next();
    });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ofcq8yt.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function run() {
    try {
        const toolsCollection = client.db("dewalt").collection("tools");
        const userCollection = client.db("dewalt").collection("users");
        const orderCollection = client.db("dewalt").collection("orders");
        const paymentCollection = client.db("dewalt").collection("payments");
        const reviewCollection = client.db("dewalt").collection("reviews");

        // Verify Admin Route
        const verifyAdmin = async (req, res, next) => {
            const initiator = req.decoded.email;
            const initiatorAccount = await userCollection.findOne({ email: initiator });

            if (initiatorAccount.role === "admin") {
                await next();
            } else {
                res.status(403).send({ message: "Error 403 - Forbidden" });
            }
        };

        // Create Payment Intent
        app.post("/create-payment-intent", jwtVerify, async (req, res) => {
            const { totalPrice } = req.body;
            const amount = parseInt(totalPrice) * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"],
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        app.get("/users", jwtVerify, async (req, res) => {
            const users = await userCollection.find({}).sort({ _id: -1 }).toArray();
            res.send(users);
        });

        app.get("/user/:email", jwtVerify, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            res.send(user);
        });

        // Authentication by JWT and update new user
        app.put("/user/:email", async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    email: user?.email,
                    name: user?.name,
                    image: user?.image,
                },
            };

            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign(user, process.env.JWT_ACCESS_TOKEN, {
                expiresIn: "1d",
            });
            res.send({ result, token });
        });

        app.patch("/update-user/:email", async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const updateDoc = {
                $set: user,
            };

            const result = await userCollection.updateOne(filter, updateDoc);

            res.send(result);
        });

        app.put("/user/admin/:email", jwtVerify, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: {
                    role: "admin",
                },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // get tools
        app.get("/tools", jwtVerify, async (req, res) => {
            const tools = await toolsCollection.find({}).sort({ _id: -1 }).toArray();
            res.send(tools);
        });

        // get single tools by id
        app.get("/tool/:id", jwtVerify, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const tool = await toolsCollection.findOne(query);
            res.send(tool);
        });

        // Add tool
        app.post("/product", jwtVerify, async (req, res) => {
            const product = req.body;
            const result = await toolsCollection.insertOne(product);
            res.send(result);
        });
        // delete order
        app.delete("/product/:id", jwtVerify, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await toolsCollection.deleteOne(query);
            res.send(result);
        });

        // get my orders
        app.get("/my-orders", jwtVerify, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            if (email === decodedEmail) {
                const query = { email };
                const orders = await orderCollection.find(query).sort({ _id: -1 }).toArray();
                res.send(orders);
            } else {
                res.status(403).send({ message: "Error 403 - Forbidden" });
            }
        });

        // get my orders
        app.get("/orders", jwtVerify, verifyAdmin, async (req, res) => {
            const orders = await orderCollection.find({}).sort({ _id: -1 }).toArray();
            res.send(orders);
        });

        // post order details
        app.post("/order", jwtVerify, async (req, res) => {
            const orderDetails = req.body;
            const result = await orderCollection.insertOne(orderDetails);
            res.send(result);
        });

        // delete order
        app.delete("/order/:id", jwtVerify, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await orderCollection.deleteOne(query);
            res.send(result);
        });

        // find single order order
        app.get("/order/:id", jwtVerify, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await orderCollection.findOne(query);
            res.send(result);
        });

        app.patch("/order/:id", async (req, res) => {
            const { id } = req.params;
            const paymentInfo = req.body;
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    status: "Pending",
                    paid: true,
                    paymentMethod: paymentInfo.paymentMethod,
                    transactionId: paymentInfo.transactionId,
                },
            };

            const updateOrder = await orderCollection.updateOne(filter, updatedDoc);
            const updatePayment = await paymentCollection.insertOne(paymentInfo);
            res.send({ updateOrder, updatePayment });
        });

        app.patch("/order/status/:id", async (req, res) => {
            const { id } = req.params;
            const status = req.body;
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    status: status.statusText,
                },
            };

            const updateOrder = await orderCollection.updateOne(filter, updatedDoc);
            res.send(updateOrder);
        });

        app.put("/review/:email", async (req, res) => {
            const email = req.params.email;
            const review = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: review,
            };

            const result = await reviewCollection.updateOne(filter, updateDoc, options);

            res.send(result);
        });

        app.get("/reviews", jwtVerify, async (req, res) => {
            const reviews = await reviewCollection.find({}).sort({ _id: -1 }).toArray();
            res.send(reviews);
        });
    } finally {
        //   await client.close();
    }
}
run().catch(console.dir);

app.get("/", (req, res) => res.send("Welcome to DEWALT-BD Server"));
app.listen(port, () => console.log(`Example app listening on port ${port}!`));
