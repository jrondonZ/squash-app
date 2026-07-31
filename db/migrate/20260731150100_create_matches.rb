# A finished match. The simulation runs entirely in the browser, so this is a
# record of a result rather than anything the server computed.
class CreateMatches < ActiveRecord::Migration[8.1]
  def change
    create_table :matches do |t|
      t.string :player_one, null: false
      t.string :player_two, null: false
      t.string :character_one, null: false
      t.string :character_two, null: false
      t.integer :games_one, null: false, default: 0
      t.integer :games_two, null: false, default: 0
      # Per-game scores, e.g. [[11, 8], [9, 11], [11, 6]].
      t.json :game_scores, null: false, default: []
      t.integer :winner, null: false
      t.integer :duration_seconds, null: false, default: 0
      t.integer :total_rallies, null: false, default: 0
      t.integer :longest_rally, null: false, default: 0
      t.references :room, foreign_key: true

      t.timestamps
    end

    add_index :matches, :created_at
    add_index :matches, :character_one
    add_index :matches, :character_two
  end
end
