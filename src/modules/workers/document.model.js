const mongoose = require('mongoose');

/**
 * WorkerDocument model
 * 
 * Stores verification and skill documents for workers
 * (government ID, selfie, certificates, etc.).
 */

const workerDocumentSchema = new mongoose.Schema(
  {
    worker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Worker',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['governmentId', 'selfie', 'certificate', 'license', 'other'],
      required: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      trim: true,
    },
    metadata: {
      type: Object,
    },
  },
  {
    timestamps: true,
  },
);

const WorkerDocument = mongoose.model('WorkerDocument', workerDocumentSchema);

module.exports = WorkerDocument;


